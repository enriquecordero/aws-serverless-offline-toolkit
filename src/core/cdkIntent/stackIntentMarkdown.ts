import { StackIntentSummary } from './stackIntentValidator';

export function generateStackIntentMarkdown(s: StackIntentSummary): string {
    const high = s.findings.filter(f => f.severity === 'high').length;
    const medium = s.findings.filter(f => f.severity === 'medium').length;
    const low = s.findings.filter(f => f.severity === 'low').length;

    const lines: string[] = [];
    lines.push('# CDK Stack Preflight Report');
    lines.push('');
    lines.push(`**Confidence Score:** ${s.confidenceScore}/100 — ${s.confidenceLabel}`);
    lines.push('');
    lines.push(`- Stacks scanned: **${s.stacksScanned}**`);
    lines.push(`- Resources scanned: **${s.resourcesScanned}**`);
    lines.push(`- Findings: **${s.findings.length}** (high: ${high}, medium: ${medium}, low: ${low})`);
    lines.push('');

    if (s.findings.length === 0) {
        lines.push('No issues found by the current intent checks.');
        return lines.join('\n');
    }

    for (const severity of ['high', 'medium', 'low'] as const) {
        const items = s.findings.filter(f => f.severity === severity);
        if (items.length === 0) { continue; }
        lines.push(`## ${severity.toUpperCase()} Findings (${items.length})`);
        lines.push('');
        for (const f of items) {
            lines.push(`- **${f.stackName}** \`${f.code}\`: ${f.message}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}
