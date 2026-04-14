import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AdoClient } from '../client.js';
import { text, error, truncate } from '../utils.js';

export function register(server: McpServer, client: AdoClient) {
  server.tool(
    'list_wikis',
    'List all wikis in a project. Azure DevOps supports project wikis and code wikis (published from a repo).',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
    },
    async ({ project }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(`${encodeURIComponent(p)}/_apis/wiki/wikis`);
        const wikis = data.value || [];
        if (!wikis.length) return text('No wikis found.');

        const lines = ['# Wikis\n'];
        for (const w of wikis) {
          lines.push(`- **${w.name}** | ID: ${w.id} | Type: ${w.type || 'N/A'} | ${w.type === 'codeWiki' ? `Repo: ${w.repositoryId} | Branch: ${w.mappedPath || 'N/A'}` : 'Project Wiki'}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_wiki_page',
    'Get the content of a specific wiki page by path.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      wikiId: z.string().describe('Wiki name or ID'),
      path: z.string().optional().default('/').describe('Page path (e.g., /Home, /Architecture/Overview)'),
      includeContent: z.boolean().optional().default(true).describe('Include page content'),
    },
    async ({ project, wikiId, path, includeContent }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/wiki/wikis/${encodeURIComponent(wikiId)}/pages`,
          { path, includeContent, recursionLevel: 'oneLevel' }
        );

        const lines = [`# Wiki Page: ${path}\n`];
        if (data.content) {
          lines.push(truncate(data.content, 5000));
        }
        if (data.subPages?.length) {
          lines.push(`\n## Sub-pages`);
          for (const sp of data.subPages) {
            lines.push(`- ${sp.path}`);
          }
        }
        if (data.page) {
          if (data.page.content) lines.push(truncate(data.page.content, 5000));
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'list_wiki_pages',
    'List all pages in a wiki (table of contents). Returns the page hierarchy.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      wikiId: z.string().describe('Wiki name or ID'),
      path: z.string().optional().default('/').describe('Root path to list from'),
    },
    async ({ project, wikiId, path }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(
          `${encodeURIComponent(p)}/_apis/wiki/wikis/${encodeURIComponent(wikiId)}/pages`,
          { path, recursionLevel: 'full' }
        );

        function formatPageTree(page: any, indent = 0): string {
          const prefix = '  '.repeat(indent);
          let result = `${prefix}- ${page.path || page.name || 'Unknown'}`;
          if (page.subPages) {
            for (const sp of page.subPages) {
              result += '\n' + formatPageTree(sp, indent + 1);
            }
          }
          return result;
        }

        return text(`# Wiki Table of Contents: ${wikiId}\n\n${formatPageTree(data)}`);
      } catch (e: any) {
        return error(e.message);
      }
    }
  );
}
