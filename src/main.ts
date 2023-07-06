import { getInput, setFailed } from '@actions/core';
import { getOctokit, context } from '@actions/github';

import { Configuration, OpenAIApi } from 'openai';

const KNOWLEDGE_PATH = '.github/issue_data.jsonl';

const prompt = `Summarize the problem and solution in the following conversation.`

interface Knowledge {
  id: number;
  title: string;
  summary: string;
  solution: string;
}

interface RepositoryMetadata {
  owner: string;
  repo: string;
}

interface RepositoryFile {
  content: string;
  sha: string;
}

async function summarizeIssue(
  apiKey: string
) {
  const configuration = new Configuration({
    apiKey: apiKey,
  });
  const openai = new OpenAIApi(configuration);

  const completion = await openai.createCompletion({
    model: 'gpt-3.5-turbo',
    prompt: prompt,
  });
}

async function getExistingKnowledge(
  token: string,
  metadata: RepositoryMetadata,
): Promise<RepositoryFile> {
  const octokit = getOctokit(token);

  try {
    const existingContent = await octokit.rest.repos.getContent({
      owner: metadata.owner,
      repo: metadata.repo,
      path: KNOWLEDGE_PATH,
    }) as {
      data: {
        content: string,
        sha: string,
      },
      status: 200 | 404,
    };

    if (existingContent.status === 404) {
      return {
        content: '',
        sha: '',
      };
    }

    const text = Buffer.from(existingContent.data.content, 'base64').toString('utf8')

    return {
      content: text,
      sha: existingContent.data.sha,
    };
  } catch (err) {
    return {
      content: '',
      sha: '',
    };
  }
}

async function saveKnowledge(
  token: string,
  metadata: RepositoryMetadata,
  knowledge: Knowledge,
) {
  const prompt = `ID: ${knowledge.id}\nTitle: ${knowledge.title}Problem: ${knowledge.summary}`;
  const knowledgeStr = `{"prompt": "${prompt}", "completion": "${knowledge.solution}"}`

  const octokit = getOctokit(token);

  const { content: prevContent, sha } = await getExistingKnowledge(token, metadata);

  const params = {
    owner: metadata.owner,
    repo: metadata.repo,
    path: KNOWLEDGE_PATH,
    content: `${prevContent}\n${knowledgeStr}`,
    message: 'chore(summarizr): update knowledge',
  };

  if (sha) {
    params['sha'] = sha;
  }

  await octokit.rest.repos.createOrUpdateFileContents(params);
}

async function hasWriteAccess(): Promise<boolean> {
  const token = getInput('access_token');
  const octokit = getOctokit(token);

  const { owner, repo } = context.issue;
  const user = context.actor;

  try {
    await octokit.rest.repos.checkCollaborator({
      owner,
      repo,
      username: user,
    });

    return true;
  } catch (err) {
    return false;
  }
}

async function run(): Promise<void> {
  try {
    const token = getInput('access_token');
    const key = getInput('openai_key');

    const octokit = getOctokit(token);
    const { number, owner, repo } = context.issue;

    const comments = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: number,
    });
    
    const anchor = comments.data.find(text => text.body && text.body.startsWith('/summarizr'));

    if (!anchor || !hasWriteAccess()) {
      return;
    }

    const reaction = await octokit.rest.reactions.createForIssueComment({
      owner,
      repo,
      comment_id: anchor.id,
      content: 'eyes',
    })

    const issue = await octokit.rest.issues.get({
      issue_number: number,
      owner,
      repo,
    });

    const anchorSummary = /[pP]roblems?:\n\n?([\s\S]+?)\n\n[sS]olutions?:\n\n?([\s\S]+)/ig.
      exec(anchor.body as string);

    if (!anchorSummary) {
      const summary = summarizeIssue(key);

      await Promise.all([
        octokit.rest.reactions.createForIssueComment({
          owner,
          repo,
          comment_id: anchor.id,
          content: '-1',
        }),
        octokit.rest.reactions.deleteForIssueComment({
          owner,
          repo,
          comment_id: anchor.id,
          reaction_id: reaction.data.id,
        }),
      ]);

      return;
    }

    const [_, problem, solution] = anchorSummary;

    await saveKnowledge(
      token,
      {
        owner,
        repo,
      },
      {
        id: number,
        title: issue.data.title,
        summary: problem,
        solution: solution,
      },
    );

    await Promise.all([
      octokit.rest.reactions.createForIssueComment({
        owner,
        repo,
        comment_id: anchor.id,
        content: '+1',
      }),
      octokit.rest.reactions.deleteForIssueComment({
        owner,
        repo,
        comment_id: anchor.id,
        reaction_id: reaction.data.id,
      }),
    ]);
  } catch (err) {
      setFailed(err);
  }
}

run();
