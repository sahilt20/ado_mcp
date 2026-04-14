export interface AdoConfig {
  orgUrl: string;
  pat: string;
  defaultProject: string;
}

export function loadConfig(): AdoConfig {
  const orgUrl = process.env.ADO_ORG_URL || '';
  const pat = process.env.ADO_PAT || '';
  const defaultProject = process.env.ADO_DEFAULT_PROJECT || '';

  if (!orgUrl) {
    console.error('Error: ADO_ORG_URL environment variable is required.');
    console.error('Example: https://dev.azure.com/myorg');
    process.exit(1);
  }

  if (!pat) {
    console.error('Error: ADO_PAT environment variable is required.');
    console.error('Generate a PAT at: https://dev.azure.com/{org}/_usersSettings/tokens');
    process.exit(1);
  }

  return { orgUrl: orgUrl.replace(/\/$/, ''), pat, defaultProject };
}
