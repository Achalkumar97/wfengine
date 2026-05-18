export {
  UpstreamValidationFailedSchema,
  validateRequiredFields,
  type UpstreamValidationFailed,
  type ValidateRequiredFieldsOptions,
  type ValidateRequiredFieldsResult,
} from "./utils/validation.js";

import type { WorkflowEngine } from "@wfengine/core";
import {
  EmailReadMessageSchema,
  EmailReadConfigSchema,
  EmailReadOutputSchema,
  emailReadNode,
} from "./email.read.js";
import {
  EmailSendConfigSchema,
  EmailSendOutputSchema,
  emailSendNode,
} from "./email.send.js";
import {
  FileReadConfigSchema,
  FileReadOutputSchema,
  fileReadNode,
} from "./file.read.js";
import {
  FileWriteConfigSchema,
  FileWriteOutputSchema,
  fileWriteNode,
} from "./file.write.js";
import { githubRepoAnalyzeNode } from "./nodes/github/repo-analyze.js";
import { githubRepoGenerateTestsLlmNode } from "./nodes/github/repo-generate-tests-llm.js";
import { githubRepoListBranchesNode } from "./nodes/github/repo-list-branches.js";
import { githubRepoRunTestsNode } from "./nodes/github/repo-run-tests.js";
import { githubFilesReadNode } from "./nodes/github/github-files-read.js";
import { llmGenerateUnitTestsNode } from "./nodes/llm/generate-unit-tests.js";
import { codeWriteTestFilesNode } from "./nodes/code/write-test-files.js";
import { httpRequestNode } from "./http.request.js";
import { noopNode } from "./noop.js";
import {
  PostgresQueryConfigSchema,
  PostgresQueryOutputSchema,
  postgresQueryNode,
} from "./postgres.query.js";
import {
  SlackSendConfigSchema,
  SlackSendOutputSchema,
  slackSendNode,
} from "./slack.send.js";
import {
  createWebhookHandler,
  webhookTriggerNode,
  type WebhookHandlerOptions,
} from "./trigger.webhook.js";
import {
  cronTriggerNode,
  scheduleWorkflowCron,
  type CronScheduleHandle,
} from "./trigger.cron.js";

export {
  HttpRequestConfigSchema,
  CronTriggerConfigSchema,
  GitHubRepoAnalyzeAnalysisMetaSchema,
  GitHubRepoAnalyzeConfigSchema,
  GitHubRepoAnalyzeOutputSchema,
  SuggestedTestCaseSchema,
  GitHubRepoRunTestsConfigSchema,
  GitHubRepoRunTestsOutputSchema,
  GitHubBranchInfoSchema,
  GitHubTagInfoSchema,
  GitHubRepoListBranchesConfigSchema,
  GitHubRepoListBranchesOutputSchema,
  GitHubFilesReadFileEntrySchema,
  GitHubFilesReadRepoInfoSchema,
  GitHubFilesReadFetchSummarySchema,
  GitHubFilesReadConfigSchema,
  GitHubFilesReadOutputSchema,
  SingleTestResultSchema,
  TestFileResultSchema,
  FailedTestDetailSchema,
  SlackSendFormSchema,
  GeneratedTestFileEntrySchema,
  GeneratedTestSummaryEntrySchema,
  GitHubRepoGenerateTestsLlmConfigSchema,
  GitHubRepoGenerateTestsLlmOutputSchema,
  GeneratedUnitTestFileSchema,
  LlmGenerateUnitTestsConfigSchema,
  LlmGenerateUnitTestsOutputSchema,
  CodeWriteTestFileEntrySchema,
  CodeWriteTestFilesWriteSummarySchema,
  CodeWriteTestFilesConfigSchema,
  CodeWriteTestFilesOutputSchema,
} from "./config-schemas.js";

export {
  httpRequestNode,
  noopNode,
  webhookTriggerNode,
  cronTriggerNode,
  emailSendNode,
  emailReadNode,
  slackSendNode,
  postgresQueryNode,
  fileReadNode,
  fileWriteNode,
  githubRepoAnalyzeNode,
  githubRepoGenerateTestsLlmNode,
  llmGenerateUnitTestsNode,
  githubRepoListBranchesNode,
  githubFilesReadNode,
  codeWriteTestFilesNode,
  githubRepoRunTestsNode,
  createWebhookHandler,
  scheduleWorkflowCron,
  EmailSendConfigSchema,
  EmailSendOutputSchema,
  EmailReadConfigSchema,
  EmailReadOutputSchema,
  EmailReadMessageSchema,
  SlackSendConfigSchema,
  SlackSendOutputSchema,
  PostgresQueryConfigSchema,
  PostgresQueryOutputSchema,
  FileReadConfigSchema,
  FileReadOutputSchema,
  FileWriteConfigSchema,
  FileWriteOutputSchema,
  type WebhookHandlerOptions,
  type CronScheduleHandle,
};

/** Register all built-in nodes on the given engine */
export function registerBuiltinNodes(engine: WorkflowEngine): void {
  engine.registerNodeReplace(noopNode);
  engine.registerNodeReplace(httpRequestNode);
  engine.registerNodeReplace(webhookTriggerNode);
  engine.registerNodeReplace(cronTriggerNode);
  engine.registerNodeReplace(emailSendNode);
  engine.registerNodeReplace(emailReadNode);
  engine.registerNodeReplace(slackSendNode);
  engine.registerNodeReplace(postgresQueryNode);
  engine.registerNodeReplace(fileReadNode);
  engine.registerNodeReplace(fileWriteNode);
  engine.registerNodeReplace(githubRepoAnalyzeNode);
  engine.registerNodeReplace(githubRepoGenerateTestsLlmNode);
  engine.registerNodeReplace(llmGenerateUnitTestsNode);
  engine.registerNodeReplace(githubRepoListBranchesNode);
  engine.registerNodeReplace(githubFilesReadNode);
  engine.registerNodeReplace(codeWriteTestFilesNode);
  engine.registerNodeReplace(githubRepoRunTestsNode);
}
