import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AdoClient } from '../client.js';
import { text, error, formatDate } from '../utils.js';

export function register(server: McpServer, client: AdoClient) {
  server.tool(
    'list_test_plans',
    'List test plans in a project.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
    },
    async ({ project }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(`${encodeURIComponent(p)}/_apis/test/plans`);
        const plans = data.value || [];
        if (!plans.length) return text('No test plans found.');

        const lines = ['# Test Plans\n'];
        for (const plan of plans) {
          lines.push(`- **${plan.name}** | ID: ${plan.id} | State: ${plan.state || 'N/A'} | Owner: ${plan.owner?.displayName || 'N/A'} | Area: ${plan.area?.name || 'N/A'} | Iteration: ${plan.iteration || 'N/A'}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'list_test_suites',
    'List test suites within a test plan.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      planId: z.number().describe('Test plan ID'),
    },
    async ({ project, planId }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(`${encodeURIComponent(p)}/_apis/test/plans/${planId}/suites`);
        const suites = data.value || [];
        if (!suites.length) return text('No test suites found.');

        const lines = [`# Test Suites — Plan ${planId}\n`];
        for (const s of suites) {
          lines.push(`- **${s.name}** | ID: ${s.id} | Type: ${s.suiteType || 'N/A'} | Test Case Count: ${s.testCaseCount || 0}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'list_test_runs',
    'List test runs in a project. Can filter by build ID to see test results for a specific build.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      buildUri: z.string().optional().describe('Filter by build URI (e.g., vstfs:///Build/Build/123)'),
      top: z.number().optional().default(25).describe('Max results (default 25)'),
      automated: z.boolean().optional().describe('Filter for automated (true) or manual (false) runs'),
    },
    async ({ project, buildUri, top, automated }) => {
      try {
        const p = client.resolveProject(project);
        const params: Record<string, string | number | boolean | undefined> = { '$top': top };
        if (buildUri) params['buildUri'] = buildUri;
        if (automated !== undefined) params['automated'] = automated;

        const data = await client.get<any>(`${encodeURIComponent(p)}/_apis/test/runs`, params);
        const runs = data.value || [];
        if (!runs.length) return text('No test runs found.');

        const lines = [`# Test Runs (${runs.length})\n`];
        for (const r of runs) {
          const stats = `Pass: ${r.passedTests || 0} | Fail: ${r.unanalyzedTests || 0} | Total: ${r.totalTests || 0}`;
          lines.push(`- **${r.name}** | ID: ${r.id} | ${r.state} | ${stats} | ${formatDate(r.completedDate || r.startedDate)}`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_test_run_results',
    'Get individual test case results from a test run. Shows pass/fail status for each test case.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      runId: z.number().describe('Test run ID'),
      top: z.number().optional().default(100).describe('Max results (default 100)'),
      outcomes: z.string().optional().describe('Filter by outcomes (comma-separated: Passed, Failed, NotExecuted, etc.)'),
    },
    async ({ project, runId, top, outcomes }) => {
      try {
        const p = client.resolveProject(project);
        const params: Record<string, string | number | boolean | undefined> = { '$top': top };
        if (outcomes) params['outcomes'] = outcomes;

        const data = await client.get<any>(`${encodeURIComponent(p)}/_apis/test/runs/${runId}/results`, params);
        const results = data.value || [];
        if (!results.length) return text('No test results found.');

        const lines = [`# Test Run ${runId} — Results (${data.count || results.length})\n`];

        // Summary
        const outcomeMap: Record<string, number> = {};
        for (const r of results) {
          outcomeMap[r.outcome || 'Unknown'] = (outcomeMap[r.outcome || 'Unknown'] || 0) + 1;
        }
        lines.push(`**Summary:** ${Object.entries(outcomeMap).map(([k, v]) => `${k}: ${v}`).join(' | ')}\n`);

        for (const r of results) {
          const icon = r.outcome === 'Passed' ? '✓' : r.outcome === 'Failed' ? '✗' : '○';
          const duration = r.durationInMs ? `${(r.durationInMs / 1000).toFixed(1)}s` : '';
          lines.push(`${icon} **${r.testCaseTitle || 'Unnamed'}** | ${r.outcome} ${duration ? `| ${duration}` : ''}`);
          if (r.outcome === 'Failed' && r.errorMessage) {
            lines.push(`  Error: ${r.errorMessage.slice(0, 200)}`);
          }
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'get_code_coverage',
    'Get code coverage statistics for a build.',
    {
      project: z.string().optional().describe('Project name (uses default if not specified)'),
      buildId: z.number().describe('Build ID'),
    },
    async ({ project, buildId }) => {
      try {
        const p = client.resolveProject(project);
        const data = await client.get<any>(`${encodeURIComponent(p)}/_apis/test/codecoverage`, { buildId });
        const coverage = data.coverageData || [];
        if (!coverage.length) return text('No code coverage data found for this build.');

        const lines = [`# Code Coverage — Build #${buildId}\n`];
        for (const cd of coverage) {
          lines.push(`## ${cd.buildFlavor || 'Default'} — ${cd.buildPlatform || 'Default'}`);
          for (const mod of (cd.coverageStats || [])) {
            const pct = mod.total > 0 ? ((mod.covered / mod.total) * 100).toFixed(1) : '0.0';
            lines.push(`- **${mod.label}:** ${mod.covered}/${mod.total} (${pct}%)`);
          }
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return error(e.message);
      }
    }
  );
}
