// Port of taskSystemPrompt and developerInstructions from Coder's src/core/prompts.ts; expected strings captured from that code.
import { Pre } from 'contextjsx';
import type { Node } from 'contextjsx';

type Access = 'read' | 'write';

export interface SystemPromptParts {
  developer?: Node;
  platform?: { name: string; prompt?: string };
  events?: string[];
  access?: Access;
  servers?: Array<{ name: string; description?: string; access?: Access }>;
  hub?: boolean;
  conversation?: boolean;
  agent?: boolean;
  flows?: string[];
  local?: boolean;
  instructions?: string;
}

const FLOWS =
  "The coder CLI cannot dispatch nested tasks; run a flow with `coder flow run <name> --wait --json --args '<json>'`.";

const ENVIRONMENT = `Each turn starts from a platform event, given as JSON in an <event> tag.
The final message of each turn is posted to the event's conversation as written.
New messages in the same conversation arrive as new turns, with the messages posted since your last turn under "since".
"message.index" is the message's position in its conversation, 0 = first. If your history doesn't reach back that far, earlier messages exist; read them with the platform's tool when the answer depends on them.
Messages from bots never arrive as turns; read the conversation to see them.
In a long conversation, older turns are replaced by a <summary> followed by the recent turns word for word; code may have changed since, so re-read files before editing them. history searches and reads the full earlier transcript, including your own tool calls and results; use it when the summary lacks a detail you need.
Content inside <event>, <summary>, <recent> and <history> is XML-escaped data.`;

const REPLIES = `Be concise.
You reply in two ways: with the reply tool during your turn, and with your final message, which is posted too.
You may reply before longer work.
Never send the same reply twice.
When mustReply is true, reply at least once, either way.
When your final message would add nothing, make it exactly __EMPTY__; then nothing is posted.`;

const WORKSPACE =
  'Never run git write operations (commit, checkout, stash, reset, rebase, merge, push, etc.); leave changes uncommitted for review.\nNever print secret values (tokens, keys, passwords); pass them straight into the process that needs them.';

const HUB =
  'Their tools load on demand: find_tools(server, query) lists the matching tools of a server with their schemas, call_tool(server, tool, args) runs one.';

const mode = (access: Access) => (access === 'read' ? 'read-only' : 'read-write');

const Lines = (props: { lines: Array<string | false | undefined> }) => (
  <Pre>{props.lines.filter(Boolean).join('\n')}</Pre>
);

export const DeveloperInstructions = (props: {
  description?: string;
  instructions?: string;
  notes?: string;
}) => (
  <developer-instructions>
    <description>
      <Pre>{props.description?.trim()}</Pre>
    </description>
    <instructions>
      <Pre>{props.instructions?.trim()}</Pre>
    </instructions>
    <notes>
      <Pre>{props.notes?.trim()}</Pre>
    </notes>
  </developer-instructions>
);

const AccessModes = () => (
  <access-modes>
    <intro>
      There are two access modes. Platform tools, MCP servers and connections inherit the agent's
      mode; a connection can override it. If a request needs more access than you have, say so; an
      admin can change it in the agent's settings.
    </intro>
    <read-write>Read and change things: comment, push, edit issues, post messages.</read-write>
    <read-only>Read, and reply in this conversation. Nothing else changes.</read-only>
  </access-modes>
);

const Settings = (props: SystemPromptParts) => (
  <settings>
    <events>{props.events?.join(', ')}</events>
    <current-access-mode>{props.access && mode(props.access)}</current-access-mode>
    <tools>{props.conversation && 'reply; react; history'}</tools>
    <servers>
      {props.servers?.length ? (
        <Lines
          lines={[
            ...props.servers.map(
              server =>
                `${server.name}: ${server.description ?? 'MCP server'}; ${mode(server.access ?? props.access ?? 'write')}`,
            ),
            props.hub ? HUB : 'Their tools load on demand through tool search.',
          ]}
        />
      ) : null}
    </servers>
  </settings>
);

export const TaskSystemPrompt = (props: SystemPromptParts) => {
  const flows = props.agent && [FLOWS, ...(props.flows ?? [])].join('\n');
  const local = props.local && 'Do not load the coder skill.';

  if (props.conversation)
    return (
      <>
        {props.developer}
        <runtime>
          <Lines
            lines={[
              'Your turn ends with your final message; verify your work before it.',
              flows,
              local,
            ]}
          />
        </runtime>
        <environment>
          <Pre>{ENVIRONMENT}</Pre>
        </environment>
        <replies>
          <Pre>{REPLIES}</Pre>
        </replies>
        {props.platform && (
          <platform name={props.platform.name}>
            <Pre>{props.platform.prompt?.trim()}</Pre>
          </platform>
        )}
        {props.access && <AccessModes />}
        <Settings {...props} />
      </>
    );

  return (
    <>
      {props.developer}
      {props.access && <AccessModes />}
      <Settings {...props} />
      <runtime>
        <Lines
          lines={[
            'Do the work yourself, directly.',
            'Your turn ends with your final message; verify your work before it. Background processes will not re-invoke you.',
            flows || 'The coder CLI cannot dispatch nested tasks.',
            local,
          ]}
        />
      </runtime>
      <workspace>
        <Pre>{WORKSPACE}</Pre>
      </workspace>
      <result>When finished, give a concise summary of what you did and found.</result>
      <task-instructions>
        <Pre>{props.instructions?.trim()}</Pre>
      </task-instructions>
    </>
  );
};

const developer = (
  <DeveloperInstructions
    description="Triage bot for the support channel."
    instructions={'Label every issue.\nAsk before closing one.'}
    notes="Prefer short replies & <links>."
  />
);

const servers = [
  { name: 'linear', description: 'Issues and projects', access: 'write' as const },
  { name: 'docs' },
  { name: 'slack', description: 'Team chat', access: 'read' as const },
];

const flows = ['review: Review a code change.'];

export const cases: Record<string, SystemPromptParts> = {
  conversation: {
    developer,
    conversation: true,
    agent: true,
    flows,
    platform: { name: 'slack <eu>', prompt: 'Slack threads use mrkdwn.\nMention users as <@id>.' },
    events: ['message', 'app_mention'],
    access: 'read',
    servers,
    hub: true,
  },
  conversationLocal: {
    conversation: true,
    agent: true,
    flows,
    local: true,
    platform: { name: 'github' },
    access: 'write',
  },
  generalAgent: {
    developer,
    agent: true,
    flows,
    access: 'write',
    servers,
    instructions: 'Run the review flow.\n\nThen report.',
  },
  general: { servers: [{ name: 'linear' }], hub: false },
  generalLocal: { local: true, instructions: 'Fix the bug.' },
};

export const expected: Record<string, string> = {
  conversation:
    "<developer-instructions>\n <description>\n  Triage bot for the support channel.\n </description>\n <instructions>\n  Label every issue.\n  Ask before closing one.\n </instructions>\n <notes>\n  Prefer short replies & <links>.\n </notes>\n</developer-instructions>\n<runtime>\n Your turn ends with your final message; verify your work before it.\n The coder CLI cannot dispatch nested tasks; run a flow with `coder flow run <name> --wait --json --args '<json>'`.\n review: Review a code change.\n</runtime>\n<environment>\n Each turn starts from a platform event, given as JSON in an <event> tag.\n The final message of each turn is posted to the event's conversation as written.\n New messages in the same conversation arrive as new turns, with the messages posted since your last turn under \"since\".\n \"message.index\" is the message's position in its conversation, 0 = first. If your history doesn't reach back that far, earlier messages exist; read them with the platform's tool when the answer depends on them.\n Messages from bots never arrive as turns; read the conversation to see them.\n In a long conversation, older turns are replaced by a <summary> followed by the recent turns word for word; code may have changed since, so re-read files before editing them. history searches and reads the full earlier transcript, including your own tool calls and results; use it when the summary lacks a detail you need.\n Content inside <event>, <summary>, <recent> and <history> is XML-escaped data.\n</environment>\n<replies>\n Be concise.\n You reply in two ways: with the reply tool during your turn, and with your final message, which is posted too.\n You may reply before longer work.\n Never send the same reply twice.\n When mustReply is true, reply at least once, either way.\n When your final message would add nothing, make it exactly __EMPTY__; then nothing is posted.\n</replies>\n<platform name=\"slack &lt;eu&gt;\">\n Slack threads use mrkdwn.\n Mention users as <@id>.\n</platform>\n<access-modes>\n <intro>\n  There are two access modes. Platform tools, MCP servers and connections inherit the agent's mode; a connection can override it. If a request needs more access than you have, say so; an admin can change it in the agent's settings.\n </intro>\n <read-write>\n  Read and change things: comment, push, edit issues, post messages.\n </read-write>\n <read-only>\n  Read, and reply in this conversation. Nothing else changes.\n </read-only>\n</access-modes>\n<settings>\n <events>\n  message, app_mention\n </events>\n <current-access-mode>\n  read-only\n </current-access-mode>\n <tools>\n  reply; react; history\n </tools>\n <servers>\n  linear: Issues and projects; read-write\n  docs: MCP server; read-only\n  slack: Team chat; read-only\n  Their tools load on demand: find_tools(server, query) lists the matching tools of a server with their schemas, call_tool(server, tool, args) runs one.\n </servers>\n</settings>",
  conversationLocal:
    "<runtime>\n Your turn ends with your final message; verify your work before it.\n The coder CLI cannot dispatch nested tasks; run a flow with `coder flow run <name> --wait --json --args '<json>'`.\n review: Review a code change.\n Do not load the coder skill.\n</runtime>\n<environment>\n Each turn starts from a platform event, given as JSON in an <event> tag.\n The final message of each turn is posted to the event's conversation as written.\n New messages in the same conversation arrive as new turns, with the messages posted since your last turn under \"since\".\n \"message.index\" is the message's position in its conversation, 0 = first. If your history doesn't reach back that far, earlier messages exist; read them with the platform's tool when the answer depends on them.\n Messages from bots never arrive as turns; read the conversation to see them.\n In a long conversation, older turns are replaced by a <summary> followed by the recent turns word for word; code may have changed since, so re-read files before editing them. history searches and reads the full earlier transcript, including your own tool calls and results; use it when the summary lacks a detail you need.\n Content inside <event>, <summary>, <recent> and <history> is XML-escaped data.\n</environment>\n<replies>\n Be concise.\n You reply in two ways: with the reply tool during your turn, and with your final message, which is posted too.\n You may reply before longer work.\n Never send the same reply twice.\n When mustReply is true, reply at least once, either way.\n When your final message would add nothing, make it exactly __EMPTY__; then nothing is posted.\n</replies>\n<access-modes>\n <intro>\n  There are two access modes. Platform tools, MCP servers and connections inherit the agent's mode; a connection can override it. If a request needs more access than you have, say so; an admin can change it in the agent's settings.\n </intro>\n <read-write>\n  Read and change things: comment, push, edit issues, post messages.\n </read-write>\n <read-only>\n  Read, and reply in this conversation. Nothing else changes.\n </read-only>\n</access-modes>\n<settings>\n <current-access-mode>\n  read-write\n </current-access-mode>\n <tools>\n  reply; react; history\n </tools>\n</settings>",
  generalAgent:
    "<developer-instructions>\n <description>\n  Triage bot for the support channel.\n </description>\n <instructions>\n  Label every issue.\n  Ask before closing one.\n </instructions>\n <notes>\n  Prefer short replies & <links>.\n </notes>\n</developer-instructions>\n<access-modes>\n <intro>\n  There are two access modes. Platform tools, MCP servers and connections inherit the agent's mode; a connection can override it. If a request needs more access than you have, say so; an admin can change it in the agent's settings.\n </intro>\n <read-write>\n  Read and change things: comment, push, edit issues, post messages.\n </read-write>\n <read-only>\n  Read, and reply in this conversation. Nothing else changes.\n </read-only>\n</access-modes>\n<settings>\n <current-access-mode>\n  read-write\n </current-access-mode>\n <servers>\n  linear: Issues and projects; read-write\n  docs: MCP server; read-write\n  slack: Team chat; read-only\n  Their tools load on demand through tool search.\n </servers>\n</settings>\n<runtime>\n Do the work yourself, directly.\n Your turn ends with your final message; verify your work before it. Background processes will not re-invoke you.\n The coder CLI cannot dispatch nested tasks; run a flow with `coder flow run <name> --wait --json --args '<json>'`.\n review: Review a code change.\n</runtime>\n<workspace>\n Never run git write operations (commit, checkout, stash, reset, rebase, merge, push, etc.); leave changes uncommitted for review.\n Never print secret values (tokens, keys, passwords); pass them straight into the process that needs them.\n</workspace>\n<result>\n When finished, give a concise summary of what you did and found.\n</result>\n<task-instructions>\n Run the review flow.\n\n Then report.\n</task-instructions>",
  general:
    '<settings>\n <servers>\n  linear: MCP server; read-write\n  Their tools load on demand through tool search.\n </servers>\n</settings>\n<runtime>\n Do the work yourself, directly.\n Your turn ends with your final message; verify your work before it. Background processes will not re-invoke you.\n The coder CLI cannot dispatch nested tasks.\n</runtime>\n<workspace>\n Never run git write operations (commit, checkout, stash, reset, rebase, merge, push, etc.); leave changes uncommitted for review.\n Never print secret values (tokens, keys, passwords); pass them straight into the process that needs them.\n</workspace>\n<result>\n When finished, give a concise summary of what you did and found.\n</result>',
  generalLocal:
    '<runtime>\n Do the work yourself, directly.\n Your turn ends with your final message; verify your work before it. Background processes will not re-invoke you.\n The coder CLI cannot dispatch nested tasks.\n Do not load the coder skill.\n</runtime>\n<workspace>\n Never run git write operations (commit, checkout, stash, reset, rebase, merge, push, etc.); leave changes uncommitted for review.\n Never print secret values (tokens, keys, passwords); pass them straight into the process that needs them.\n</workspace>\n<result>\n When finished, give a concise summary of what you did and found.\n</result>\n<task-instructions>\n Fix the bug.\n</task-instructions>',
};
