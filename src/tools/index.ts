import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AdoClient } from '../client.js';

import { register as registerProjects } from './projects.js';
import { register as registerWorkItems } from './workitems.js';
import { register as registerRepos } from './repos.js';
import { register as registerPipelines } from './pipelines.js';
import { register as registerReleases } from './releases.js';
import { register as registerTests } from './tests.js';
import { register as registerWiki } from './wiki.js';
import { register as registerComposite } from './composite.js';

export function registerAllTools(server: McpServer, client: AdoClient) {
  registerProjects(server, client);
  registerWorkItems(server, client);
  registerRepos(server, client);
  registerPipelines(server, client);
  registerReleases(server, client);
  registerTests(server, client);
  registerWiki(server, client);
  registerComposite(server, client);
}
