// Helpers for formatting ADO API responses into readable text

export function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}

export function error(message: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true as const };
}

export function formatDate(d: string | undefined | null): string {
  if (!d) return 'N/A';
  return new Date(d).toLocaleString();
}

export function truncate(s: string | undefined | null, max = 500): string {
  if (!s) return 'N/A';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export function stripHtml(html: string | undefined | null): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|ul|ol|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatWorkItem(wi: any): string {
  const f = wi.fields || {};
  const lines = [
    `## Work Item #${wi.id}: ${f['System.Title'] || 'Untitled'}`,
    `- **Type:** ${f['System.WorkItemType'] || 'N/A'}`,
    `- **State:** ${f['System.State'] || 'N/A'}`,
    `- **Assigned To:** ${f['System.AssignedTo']?.displayName || 'Unassigned'}`,
    `- **Area:** ${f['System.AreaPath'] || 'N/A'}`,
    `- **Iteration:** ${f['System.IterationPath'] || 'N/A'}`,
    `- **Priority:** ${f['Microsoft.VSTS.Common.Priority'] || 'N/A'}`,
    `- **Created:** ${formatDate(f['System.CreatedDate'])}`,
    `- **Changed:** ${formatDate(f['System.ChangedDate'])}`,
    `- **Tags:** ${f['System.Tags'] || 'None'}`,
  ];

  if (f['System.Description']) {
    lines.push(`\n**Description:**\n${truncate(stripHtml(f['System.Description']), 1000)}`);
  }
  if (f['Microsoft.VSTS.Common.AcceptanceCriteria']) {
    lines.push(`\n**Acceptance Criteria:**\n${truncate(stripHtml(f['Microsoft.VSTS.Common.AcceptanceCriteria']), 1000)}`);
  }

  // Relations
  if (wi.relations?.length) {
    lines.push(`\n**Relations:** ${wi.relations.length} linked items`);
    for (const rel of wi.relations.slice(0, 20)) {
      const name = rel.attributes?.name || rel.rel || 'Link';
      lines.push(`  - ${name}: ${rel.url || 'N/A'}`);
    }
  }

  return lines.join('\n');
}

export function formatCommit(c: any): string {
  return [
    `- **${(c.commitId || c.objectId || '').slice(0, 8)}** | ${c.author?.name || 'Unknown'} | ${formatDate(c.author?.date)} | ${c.comment || c.message || 'No message'}`,
  ].join('');
}

export function formatPullRequest(pr: any): string {
  const reviewers = (pr.reviewers || [])
    .map((r: any) => `${r.displayName} (${r.vote > 0 ? 'Approved' : r.vote < 0 ? 'Rejected' : 'Pending'})`)
    .join(', ');

  return [
    `## PR #${pr.pullRequestId}: ${pr.title}`,
    `- **Status:** ${pr.status}`,
    `- **Created By:** ${pr.createdBy?.displayName || 'Unknown'}`,
    `- **Source:** ${pr.sourceRefName?.replace('refs/heads/', '')} → ${pr.targetRefName?.replace('refs/heads/', '')}`,
    `- **Created:** ${formatDate(pr.creationDate)}`,
    `- **Merge Status:** ${pr.mergeStatus || 'N/A'}`,
    reviewers ? `- **Reviewers:** ${reviewers}` : '',
    pr.description ? `\n**Description:**\n${truncate(stripHtml(pr.description), 500)}` : '',
  ].filter(Boolean).join('\n');
}

export function formatBuild(b: any): string {
  return [
    `- **#${b.id}** | ${b.definition?.name || 'N/A'} | ${b.status} | ${b.result || 'In Progress'} | ${formatDate(b.startTime)} | ${b.requestedFor?.displayName || 'N/A'}`,
  ].join('');
}

export function formatRelease(r: any): string {
  const envs = (r.environments || [])
    .map((e: any) => `${e.name}: ${e.status}`)
    .join(', ');
  return [
    `- **Release ${r.id}** | ${r.name} | ${r.status} | ${formatDate(r.createdOn)}${envs ? ` | Envs: ${envs}` : ''}`,
  ].join('');
}
