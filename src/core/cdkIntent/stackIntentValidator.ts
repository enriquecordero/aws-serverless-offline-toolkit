import * as fs from 'fs';
import * as path from 'path';

export interface StackIntentFinding {
    severity: 'low' | 'medium' | 'high';
    code: string;
    message: string;
    stackName: string;
}

export interface StackIntentSummary {
    stacksScanned: number;
    resourcesScanned: number;
    findings: StackIntentFinding[];
    confidenceScore: number;
    confidenceLabel: string;
}

export function computeConfidenceScore(summary: Omit<StackIntentSummary, 'confidenceScore' | 'confidenceLabel'>): { score: number; label: string } {
    if (summary.stacksScanned === 0) {
        return { score: 0, label: 'No Stacks Found' };
    }
    const high = summary.findings.filter(f => f.severity === 'high').length;
    const medium = summary.findings.filter(f => f.severity === 'medium').length;
    const low = summary.findings.filter(f => f.severity === 'low').length;
    const score = Math.max(0, Math.min(100, 100 - high * 15 - medium * 7 - low * 2));
    let label: string;
    if (score >= 90) { label = 'Ready to Deploy'; }
    else if (score >= 75) { label = 'Minor Issues'; }
    else if (score >= 50) { label = 'Review Needed'; }
    else if (score >= 25) { label = 'Significant Issues'; }
    else { label = 'Not Ready'; }
    return { score, label };
}

interface ResourceMap {
    [logicalId: string]: {
        Type: string;
        Properties?: Record<string, unknown>;
    };
}

function getRefName(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const ref = (value as { Ref?: unknown }).Ref;
    return typeof ref === 'string' ? ref : undefined;
}

function getGetAttTarget(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const getAtt = (value as { 'Fn::GetAtt'?: unknown })['Fn::GetAtt'];
    if (Array.isArray(getAtt) && typeof getAtt[0] === 'string') {
        return getAtt[0];
    }
    return undefined;
}

function toArray<T>(value: unknown): T[] {
    if (!value) {
        return [];
    }
    return Array.isArray(value) ? (value as T[]) : [value as T];
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === 'string');
}

function normalizeFindings(findings: StackIntentFinding[]): StackIntentFinding[] {
    const seen = new Set<string>();
    const out: StackIntentFinding[] = [];
    for (const finding of findings) {
        const key = `${finding.stackName}|${finding.code}|${finding.message}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(finding);
    }

    const severityRank = { high: 0, medium: 1, low: 2 } as const;
    out.sort((a, b) => {
        const bySeverity = severityRank[a.severity] - severityRank[b.severity];
        if (bySeverity !== 0) {
            return bySeverity;
        }
        if (a.stackName !== b.stackName) {
            return a.stackName.localeCompare(b.stackName);
        }
        return a.code.localeCompare(b.code);
    });

    return out;
}

function findTemplateFiles(workspaceRoot: string): string[] {
    const cdkOutPath = path.join(workspaceRoot, 'cdk.out');
    if (!fs.existsSync(cdkOutPath) || !fs.statSync(cdkOutPath).isDirectory()) {
        return [];
    }

    return fs.readdirSync(cdkOutPath)
        .filter(file => file.endsWith('.template.json'))
        .map(file => path.join(cdkOutPath, file));
}

function parseTemplate(filePath: string): { stackName: string; resources: ResourceMap } | null {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const json = JSON.parse(raw) as { Resources?: ResourceMap };
        const resources = json.Resources ?? {};
        return {
            stackName: path.basename(filePath).replace('.template.json', ''),
            resources,
        };
    } catch {
        return null;
    }
}

export function validateStackIntent(workspaceRoots: string[]): StackIntentSummary {
    const findings: StackIntentFinding[] = [];
    let stacksScanned = 0;
    let resourcesScanned = 0;

    for (const root of workspaceRoots) {
        const templateFiles = findTemplateFiles(root);

        if (templateFiles.length === 0) {
            findings.push({
                severity: 'medium',
                code: 'CDK_OUT_TEMPLATES_NOT_FOUND',
                message: `No synthesized templates found under ${path.join(root, 'cdk.out')}. Run 'cdk synth' first.`,
                stackName: path.basename(root),
            });
            continue;
        }

        for (const templateFile of templateFiles) {
            const parsed = parseTemplate(templateFile);
            if (!parsed) {
                findings.push({
                    severity: 'medium',
                    code: 'TEMPLATE_PARSE_FAILED',
                    message: `Could not parse template: ${path.basename(templateFile)}`,
                    stackName: path.basename(templateFile),
                });
                continue;
            }

            stacksScanned += 1;
            const { stackName, resources } = parsed;
            const entries = Object.entries(resources);
            resourcesScanned += entries.length;

            const resourceByLogicalId = new Map(entries.map(([logicalId, resource]) => [logicalId, resource]));

            const dataSources = entries.filter(([, r]) => r.Type === 'AWS::AppSync::DataSource');
            const dataSourceIds = new Set(dataSources.map(([logicalId]) => logicalId));
            const dataSourceNames = new Set(
                dataSources
                    .map(([, resource]) => resource.Properties?.Name)
                    .filter((name): name is string => typeof name === 'string')
            );

            const lambdaIds = new Set(
                entries
                    .filter(([, r]) => r.Type === 'AWS::Lambda::Function')
                    .map(([logicalId]) => logicalId)
            );

            const dynamoTableIds = new Set(
                entries
                    .filter(([, r]) => r.Type === 'AWS::DynamoDB::Table')
                    .map(([logicalId]) => logicalId)
            );

            const resolverEntries = entries.filter(([, r]) => r.Type === 'AWS::AppSync::Resolver');

            if (resolverEntries.length > 0 && dataSourceIds.size === 0) {
                findings.push({
                    severity: 'high',
                    code: 'APPSYNC_RESOLVER_WITHOUT_DATASOURCE',
                    message: 'Resolvers found but no AppSync DataSource resources were synthesized.',
                    stackName,
                });
            }

            for (const [logicalId, resource] of resolverEntries) {
                const dsRef = resource.Properties?.DataSourceName;
                if (!dsRef) {
                    findings.push({
                        severity: 'high',
                        code: 'RESOLVER_MISSING_DATASOURCE_NAME',
                        message: `Resolver ${logicalId} is missing DataSourceName.`,
                        stackName,
                    });
                    continue;
                }

                const refName = getRefName(dsRef);
                const getAttName = getGetAttTarget(dsRef);
                const explicitName = typeof dsRef === 'string' ? dsRef : undefined;
                const resolvedName = refName ?? getAttName ?? explicitName;

                if (!resolvedName) {
                    findings.push({
                        severity: 'high',
                        code: 'RESOLVER_DATASOURCE_UNRESOLVED',
                        message: `Resolver ${logicalId} has DataSourceName that could not be resolved.`,
                        stackName,
                    });
                    continue;
                }

                if (!dataSourceIds.has(resolvedName) && !dataSourceNames.has(resolvedName)) {
                    findings.push({
                        severity: 'high',
                        code: 'RESOLVER_DATASOURCE_REF_NOT_FOUND',
                        message: `Resolver ${logicalId} references unknown DataSource '${resolvedName}'.`,
                        stackName,
                    });
                }
            }

            for (const [logicalId, resource] of dataSources) {
                const dsType = resource.Properties?.Type;
                if (dsType === 'AWS_LAMBDA') {
                    const lambdaArn = resource.Properties?.LambdaConfig &&
                        (resource.Properties.LambdaConfig as Record<string, unknown>).LambdaFunctionArn;
                    const lambdaRef = getGetAttTarget(lambdaArn) ?? getRefName(lambdaArn);
                    if (!lambdaRef) {
                        findings.push({
                            severity: 'high',
                            code: 'APPSYNC_LAMBDA_DATASOURCE_MISSING_TARGET',
                            message: `DataSource ${logicalId} is AWS_LAMBDA but has no resolvable LambdaFunctionArn target.`,
                            stackName,
                        });
                    } else if (!lambdaIds.has(lambdaRef)) {
                        findings.push({
                            severity: 'high',
                            code: 'APPSYNC_LAMBDA_DATASOURCE_TARGET_NOT_FOUND',
                            message: `DataSource ${logicalId} references Lambda '${lambdaRef}' that is not in template resources.`,
                            stackName,
                        });
                    }
                }

                if (dsType === 'AMAZON_DYNAMODB') {
                    const tableName = resource.Properties?.DynamoDBConfig &&
                        (resource.Properties.DynamoDBConfig as Record<string, unknown>).TableName;
                    const tableRef = getRefName(tableName);
                    if (tableRef && !dynamoTableIds.has(tableRef)) {
                        findings.push({
                            severity: 'high',
                            code: 'APPSYNC_DDB_DATASOURCE_TABLE_NOT_FOUND',
                            message: `DataSource ${logicalId} references DynamoDB table '${tableRef}' that is not in template resources.`,
                            stackName,
                        });
                    }
                }
            }

            const lambdaEntries = entries.filter(([, r]) => r.Type === 'AWS::Lambda::Function');
            for (const [logicalId, resource] of lambdaEntries) {
                if (!resource.Properties?.Role) {
                    findings.push({
                        severity: 'medium',
                        code: 'LAMBDA_ROLE_MISSING',
                        message: `Lambda ${logicalId} has no explicit execution Role in synthesized template.`,
                        stackName,
                    });
                    continue;
                }

                const roleRef = getRefName(resource.Properties.Role) ?? getGetAttTarget(resource.Properties.Role);
                if (roleRef) {
                    const roleResource = resourceByLogicalId.get(roleRef);
                    if (!roleResource || roleResource.Type !== 'AWS::IAM::Role') {
                        findings.push({
                            severity: 'high',
                            code: 'LAMBDA_ROLE_REF_NOT_FOUND',
                            message: `Lambda ${logicalId} references IAM role '${roleRef}' that is not present in template resources.`,
                            stackName,
                        });
                    }
                }
            }

            const iamRoles = entries.filter(([, r]) => r.Type === 'AWS::IAM::Role');

            const evaluatePolicyStatements = (
                ownerId: string,
                statementsInput: unknown,
                ownerLabel: string
            ): void => {
                const statements = toArray<Record<string, unknown>>(statementsInput);
                for (const statement of statements) {
                    const effect = statement.Effect;
                    if (effect !== 'Allow') {
                        continue;
                    }

                    const actions = asStringArray(statement.Action);
                    const resourcesAllowed = asStringArray(statement.Resource);

                    if (actions.includes('*') || actions.some(action => action.endsWith(':*'))) {
                        findings.push({
                            severity: 'high',
                            code: 'IAM_POLICY_WILDCARD_ACTION',
                            message: `${ownerLabel} ${ownerId} has wildcard action in allow policy statement.`,
                            stackName,
                        });
                    }

                    if (resourcesAllowed.includes('*')) {
                        findings.push({
                            severity: 'medium',
                            code: 'IAM_POLICY_WILDCARD_RESOURCE',
                            message: `${ownerLabel} ${ownerId} allows Resource '*'.`,
                            stackName,
                        });
                    }
                }
            };

            for (const [logicalId, resource] of iamRoles) {
                const policies = toArray<{ PolicyDocument?: { Statement?: unknown } }>(resource.Properties?.Policies);
                for (const policy of policies) {
                    evaluatePolicyStatements(logicalId, policy.PolicyDocument?.Statement, 'IAM role');
                }
            }

            const iamPolicies = entries.filter(([, r]) => r.Type === 'AWS::IAM::Policy');
            for (const [logicalId, resource] of iamPolicies) {
                const policyDoc = resource.Properties?.PolicyDocument as { Statement?: unknown } | undefined;
                evaluatePolicyStatements(logicalId, policyDoc?.Statement, 'IAM policy');
            }

            for (const [logicalId, resource] of dataSources) {
                const serviceRoleArn = resource.Properties?.ServiceRoleArn;
                if (!serviceRoleArn) {
                    continue;
                }

                const roleRef = getRefName(serviceRoleArn) ?? getGetAttTarget(serviceRoleArn);
                if (!roleRef) {
                    findings.push({
                        severity: 'medium',
                        code: 'APPSYNC_DATASOURCE_ROLE_UNRESOLVED',
                        message: `DataSource ${logicalId} has ServiceRoleArn that could not be resolved to a role resource.`,
                        stackName,
                    });
                    continue;
                }

                const roleResource = resourceByLogicalId.get(roleRef);
                if (!roleResource || roleResource.Type !== 'AWS::IAM::Role') {
                    findings.push({
                        severity: 'high',
                        code: 'APPSYNC_DATASOURCE_ROLE_NOT_FOUND',
                        message: `DataSource ${logicalId} references IAM role '${roleRef}' that is not present in template resources.`,
                        stackName,
                    });
                }
            }

            const dynamoTables = entries.filter(([, r]) => r.Type === 'AWS::DynamoDB::Table');
            if (dynamoTables.length === 0) {
                findings.push({
                    severity: 'low',
                    code: 'NO_DYNAMODB_TABLES_FOUND',
                    message: 'No DynamoDB tables were found in this stack template.',
                    stackName,
                });
            }
        }
    }

    const base = { stacksScanned, resourcesScanned, findings: normalizeFindings(findings) };
    const { score, label } = computeConfidenceScore(base);
    return { ...base, confidenceScore: score, confidenceLabel: label };
}
