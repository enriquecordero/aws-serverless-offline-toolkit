import { DiffSummary, DiffChange, RiskLevel } from '../../shared/types';

const RISK_EMOJI: Record<RiskLevel, string> = {
  critical: '🚨',
  high: '🔴',
  medium: '🟡',
  low: '🟢',
};

const CHANGE_EMOJI: Record<string, string> = {
  added: '✅',
  modified: '✏️',
  deleted: '🗑️',
  replaced: '♻️',
};

function changeSection(title: string, changes: DiffChange[]): string {
  if (changes.length === 0) { return ''; }

  const rows = changes.map(c =>
    `| ${CHANGE_EMOJI[c.changeType]} | \`${c.resourceType}\` | ${c.logicalId} | ${RISK_EMOJI[c.riskLevel]} ${c.riskLevel.toUpperCase()} |`
  ).join('\n');

  return `
### ${title} (${changes.length})

| | Resource Type | Logical ID | Risk |
|---|---|---|---|
${rows}
`;
}

function findingsSection(summary: DiffSummary): string {
  const critical = [...summary.added, ...summary.modified, ...summary.deleted, ...summary.replaced]
    .filter(c => c.riskLevel === 'critical' || c.riskLevel === 'high');

  if (critical.length === 0) { return ''; }

  const items = critical.map(c => `
#### ${RISK_EMOJI[c.riskLevel]} ${c.riskLevel.toUpperCase()}: ${c.logicalId}

**Type:** \`${c.resourceType}\`  
**Change:** ${c.changeType}

${c.explanation}

${c.recommendation ? `> **Recommendation:** ${c.recommendation}` : ''}
`).join('\n---\n');

  return `
## 🔍 Key Findings

${items}
`;
}

export function generateMarkdownReport(summary: DiffSummary): string {
  const { riskCounts, highestRisk } = summary;

  const riskBadge = `${RISK_EMOJI[highestRisk]} **Overall Risk: ${highestRisk.toUpperCase()}**`;

  const riskTable = `
| Risk Level | Count |
|---|---|
| 🚨 Critical | ${riskCounts.critical} |
| 🔴 High | ${riskCounts.high} |
| 🟡 Medium | ${riskCounts.medium} |
| 🟢 Low | ${riskCounts.low} |
`;

  const recoSection = summary.recommendations.length > 0
    ? `\n## ✅ Recommendations Before Deploying\n\n${summary.recommendations.map(r => `- ${r}`).join('\n')}\n`
    : '';

  return `# CDK Diff Report

> Generated: ${new Date(summary.timestamp).toLocaleString()}${summary.stackName ? `  \n> Stack: \`${summary.stackName}\`` : ''}

${riskBadge}

## 📊 Summary

**Total Changes:** ${summary.totalChanges}

${riskTable}
${changeSection('Added', summary.added)}
${changeSection('Modified', summary.modified)}
${changeSection('Deleted', summary.deleted)}
${changeSection('Replaced (destructive)', summary.replaced)}
${findingsSection(summary)}
${recoSection}
---

<details>
<summary>📄 Raw CDK Diff Output</summary>

\`\`\`
${summary.rawOutput.trim()}
\`\`\`

</details>
`;
}
