import { getInput } from '@actions/core';
import dedent from 'dedent';

import { OpenAI } from 'langchain/llms/openai';

import type { GithubIssue, GithubComment } from '@/types/github';

const conversationPrompt = `Summarize the problem and solution from the following conversation in the provided format. Interaction with conversation participants will be separated by '###'.

Conversation may have a title or a link to a reproduction attempt that can be used to understand the context of the conversation.`;

const bodyPrompt = `Summarize the following article. The article may have a title or a link to a reproduction attempt that can be used to understand the context. Emphasize the problems that can be found in the article.`;

function getLLM() {
  const modelKey = getInput('api_key');
  const modelName = getInput('model_name');
  const maxTokens = Number(getInput('max_tokens'));

  return new OpenAI({
    openAIApiKey: modelKey,
    modelName,
    maxTokens,
  });
}

function formatIssueToPrompt(
  issue: GithubIssue,
  comments: GithubComment[],
) {
  const commentStr = comments.map(comment => `@${comment.user.name}: ${comment.body}`);
  return dedent`
  Title: ${issue.title}

  ###
  ${commentStr.join("\n###\n")}
  ###

  Problem:
  Solution:
  `;
}

export async function summarizeIssueBody(issue: GithubIssue): Promise<string> {
  const llm = getLLM();

  return llm.call(
    dedent`
    ${bodyPrompt}

    ${issue.body}
    `,
  );
}

export async function summarizeIssue(
  issue: GithubIssue,
  comments: GithubComment[],
): Promise<string> {
  const llm = getLLM();

  const prompt = `${conversationPrompt}\n\n${formatIssueToPrompt(issue, comments)}`;

  return llm.call(prompt);
}

