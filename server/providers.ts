import { z } from 'zod';
import type {
  Message,
  Model,
  ModelResponse,
  Provider,
  ToolCall,
  ToolSchema,
  Usage,
} from '../shared/contracts.ts';
import type { Vault } from './vault.ts';
import { authenticationFailure, providerHeaders } from './provider-auth.ts';

export interface ModelRequest {
  provider: Provider;
  model: Model;
  system: string;
  messages: Message[];
  tools: ToolSchema[];
  signal: AbortSignal;
}

export interface ProviderAdapter {
  validate?(provider: Provider): void;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

const object = z.record(z.string(), z.unknown());

/* -------------------------------------------------------------------------- */
/*                                  Schemas                                   */
/* -------------------------------------------------------------------------- */

const openAIChatResponse = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullish(),

        reasoning_details: z.array(z.unknown()).optional(),

        tool_calls: z
          .array(
            z.object({
              id: z.string(),
              function: z.object({
                name: z.string(),
                arguments: z.string(),
              }),
            }),
          )
          .optional(),
      }),

      finish_reason: z.string().nullish(),
    }),
  ),

  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),

      prompt_tokens_details: z
        .object({
          cached_tokens: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

const openAIResponsesResponse = z.object({
  status: z.string().optional(),

  incomplete_details: z
    .object({
      reason: z.string().optional(),
    })
    .nullish(),

  output: z.array(object),

  usage: z
    .object({
      input_tokens: z.number(),
      output_tokens: z.number(),

      input_tokens_details: z
        .object({
          cached_tokens: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

const anthropicResponse = z.object({
  content: z.array(
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('text'),
        text: z.string(),
      }),

      z.object({
        type: z.literal('tool_use'),
        id: z.string(),
        name: z.string(),
        input: object,
      }),

      z.object({
        type: z.literal('thinking'),
        thinking: z.string(),
        signature: z.string(),
      }),
    ]),
  ),

  stop_reason: z.string().nullish(),

  usage: z
    .object({
      input_tokens: z.number(),
      output_tokens: z.number(),

      cache_read_input_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
    })
    .optional(),
});

const geminiResponse = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(
              z.object({
                text: z.string().optional(),
                thought: z.boolean().optional(),
                thoughtSignature: z.string().optional(),

                functionCall: z
                  .object({
                    name: z.string(),
                    args: object,
                  })
                  .optional(),
              }),
            ),
          })
          .optional(),

        finishReason: z.string().optional(),
      }),
    )
    .optional(),

  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      cachedContentTokenCount: z.number().optional(),
      thoughtsTokenCount: z.number().optional(),
    })
    .optional(),
});

const ollamaArguments = z.union([object, z.string()]);

const ollamaResponse = z.object({
  message: z.object({
    content: z.string().nullish(),
    thinking: z.string().optional(),

    tool_calls: z
      .array(
        z.object({
          function: z.object({
            name: z.string(),
            arguments: ollamaArguments,
          }),
        }),
      )
      .optional(),
  }),

  done_reason: z.string().nullish().optional(),

  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
});

type OllamaMode = 'native' | 'openai';

/* -------------------------------------------------------------------------- */
/*                              Signature storage                             */
/* -------------------------------------------------------------------------- */

const OPENAI_REASONING_PREFIX = 'agentscope:openai-reasoning:';
const OPENROUTER_REASONING_PREFIX = 'agentscope:openrouter-reasoning:';
const ANTHROPIC_THINKING_PREFIX = 'agentscope:anthropic-thinking:';

function encodeOpaque(prefix: string, value: unknown): string {
  return `${prefix}${Buffer.from(JSON.stringify(value), 'utf8').toString(
    'base64',
  )}`;
}

function decodeOpaque(
  prefix: string,
  value: string | undefined,
): unknown | undefined {
  if (!value?.startsWith(prefix)) return undefined;

  try {
    const encoded = value.slice(prefix.length);
    const raw = Buffer.from(encoded, 'base64').toString('utf8');

    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/*                              Endpoint helpers                              */
/* -------------------------------------------------------------------------- */

export function validateEndpoint(value: string) {
  const url = new URL(value);

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'Endpoint must not include credentials, query strings, or fragments.',
    );
  }

  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
  ) {
    throw new Error('Use HTTPS, or HTTP for a local provider.');
  }

  return url.toString().replace(/\/$/, '');
}

function cleanPath(base: string) {
  return new URL(base).pathname.replace(/\/+$/, '');
}

function openAIChatEndpoint(base: string) {
  const url = new URL(base);
  const path = cleanPath(base);

  if (path.endsWith('/chat/completions')) {
    return base;
  }

  if (!path && url.hostname === 'api.openai.com') {
    return `${base}/v1/chat/completions`;
  }

  return `${base}/chat/completions`;
}

function openAIResponsesEndpoint(base: string) {
  const url = new URL(base);
  const path = cleanPath(base);

  if (path.endsWith('/responses')) {
    return base;
  }

  if (!path && url.hostname === 'api.openai.com') {
    return `${base}/v1/responses`;
  }

  return `${base}/responses`;
}

function openRouterEndpoint(base: string) {
  const url = new URL(base);
  const path = cleanPath(base);

  if (path.endsWith('/chat/completions')) {
    return base;
  }

  if (!path && url.hostname === 'openrouter.ai') {
    return `${base}/api/v1/chat/completions`;
  }

  return `${base}/chat/completions`;
}

function anthropicEndpoint(base: string) {
  const url = new URL(base);
  const path = cleanPath(base);

  if (path.endsWith('/messages')) {
    return base;
  }

  if (!path && url.hostname === 'api.anthropic.com') {
    return `${base}/v1/messages`;
  }

  return `${base}/messages`;
}

function geminiEndpoint(base: string, modelId: string) {
  const url = new URL(base);
  const path = cleanPath(base);

  if (/\/models\/[^/]+:generateContent$/.test(path)) {
    return base;
  }

  let root = base;

  if (!path && url.hostname === 'generativelanguage.googleapis.com') {
    root = `${base}/v1beta`;
  }

  return `${root}/models/${encodeURIComponent(modelId)}:generateContent`;
}

/**
 * Ollama accepts both:
 *
 * Native:
 *   http://localhost:11434/api/chat
 *   https://ollama.com/api/chat
 *
 * OpenAI-compatible:
 *   http://localhost:11434/v1/chat/completions
 *
 * Users may enter the server root, /api, /api/chat, /v1, or the full
 * OpenAI-compatible endpoint.
 */
function ollamaEndpoint(base: string): {
  endpoint: string;
  mode: OllamaMode;
} {
  const path = cleanPath(base);

  if (path.endsWith('/v1/chat/completions')) {
    return {
      endpoint: base,
      mode: 'openai',
    };
  }

  if (path.endsWith('/v1')) {
    return {
      endpoint: `${base}/chat/completions`,
      mode: 'openai',
    };
  }

  if (path.endsWith('/api/chat')) {
    return {
      endpoint: base,
      mode: 'native',
    };
  }

  if (path.endsWith('/api')) {
    return {
      endpoint: `${base}/chat`,
      mode: 'native',
    };
  }

  return {
    endpoint: `${base}/api/chat`,
    mode: 'native',
  };
}

/* -------------------------------------------------------------------------- */
/*                                Arguments                                   */
/* -------------------------------------------------------------------------- */

function parseToolArguments(
  value: Record<string, unknown> | string,
): Record<string, unknown> {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return object.parse(JSON.parse(value));
  } catch {
    return {
      value,
    };
  }
}

function parseFunctionArguments(value: string): Record<string, unknown> {
  try {
    return object.parse(JSON.parse(value));
  } catch {
    return {
      value,
    };
  }
}

/* -------------------------------------------------------------------------- */
/*                           Provider reasoning config                        */
/* -------------------------------------------------------------------------- */

function ollamaThinking(model: Model): boolean | string | undefined {
  const effort = model.reasoningEffort;

  if (!effort) return undefined;

  switch (effort) {
    case 'none':
      return false;

    case 'minimal':
      return 'low';

    case 'low':
    case 'medium':
    case 'high':
    case 'max':
      return effort;

    case 'xhigh':
      return 'max';

    default:
      return undefined;
  }
}

function geminiThinkingConfig(
  model: Model,
): Record<string, unknown> | undefined {
  const effort = model.reasoningEffort;

  if (!effort || effort === 'none') {
    return undefined;
  }

  const match = /^gemini-(\d+)/i.exec(model.id);

  if (!match) {
    return undefined;
  }

  const major = Number(match[1]);

  // Gemini 2.5 does not support thinkingLevel.
  if (!Number.isFinite(major) || major < 3) {
    return undefined;
  }

  let thinkingLevel: string;

  switch (effort) {
    case 'minimal':
      thinkingLevel = 'minimal';
      break;

    case 'low':
      thinkingLevel = 'low';
      break;

    case 'medium':
      thinkingLevel = 'medium';
      break;

    case 'high':
    case 'xhigh':
    case 'max':
      thinkingLevel = 'high';
      break;

    default:
      return undefined;
  }

  return {
    thinkingLevel,
  };
}

function isClaudeAdaptiveModel(modelId: string) {
  return (
    /claude-(?:opus|sonnet)-4-(?:6|7|8|9)/i.test(modelId) ||
    /claude-(?:opus|sonnet|fable|mythos)-5/i.test(modelId) ||
    /claude-mythos-preview/i.test(modelId)
  );
}

function anthropicReasoningConfig(
  model: Model,
):
  | {
      thinking?: Record<string, unknown>;
      output_config?: Record<string, unknown>;
    }
  | undefined {
  const effort = model.reasoningEffort;

  if (!effort || effort === 'none') {
    return undefined;
  }

  if (!isClaudeAdaptiveModel(model.id)) {
    return undefined;
  }

  const isClaude5 = /claude-(?:opus|sonnet|fable|mythos)-5/i.test(model.id);

  if (isClaude5) {
    return {
      output_config: {
        effort,
      },
    };
  }

  return {
    thinking: {
      type: 'adaptive',
    },

    output_config: {
      effort,
    },
  };
}

function openAIReasoningConfig(
  model: Model,
): Record<string, unknown> | undefined {
  const effort = model.reasoningEffort;

  if (!effort) {
    return undefined;
  }

  // GPT-6 Astra does not accept "none".
  if (effort === 'none' && /gpt-6-astra/i.test(model.id)) {
    return undefined;
  }

  return {
    effort,
  };
}

function openRouterReasoningConfig(
  model: Model,
): Record<string, unknown> | undefined {
  const effort = model.reasoningEffort;

  if (!effort) {
    return undefined;
  }

  return {
    effort,
  };
}

/* -------------------------------------------------------------------------- */
/*                              Message builders                              */
/* -------------------------------------------------------------------------- */

function findToolName(req: ModelRequest, id: string | undefined) {
  if (!id) return undefined;

  for (const message of req.messages) {
    for (const toolCall of message.toolCalls ?? []) {
      if (toolCall.id === id) {
        return toolCall.name;
      }
    }
  }

  return undefined;
}

function ollamaMessages(req: ModelRequest) {
  return [
    {
      role: 'system',
      content: req.system,
    },

    ...req.messages.map((message) => {
      if (message.role === 'tool') {
        const toolName =
          message.name ?? findToolName(req, message.toolCallId);

        return {
          role: 'tool',
          content: message.content,

          ...(toolName
            ? {
                tool_name: toolName,
              }
            : {}),
        };
      }

      return {
        role: message.role,
        content: message.content || '',

        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((toolCall) => ({
                type: 'function',

                function: {
                  name: toolCall.name,
                  arguments: toolCall.arguments,
                },
              })),
            }
          : {}),
      };
    }),
  ];
}

function openAIMessages(req: ModelRequest) {
  return [
    {
      role: 'system',
      content: req.system,
    },

    ...req.messages.map((message) =>
      message.role === 'tool'
        ? {
            role: 'tool',
            tool_call_id: message.toolCallId,
            content: message.content,
          }
        : {
            role: message.role,
            content: message.content || null,

            ...(message.toolCalls?.length
              ? {
                  tool_calls: message.toolCalls.map((toolCall) => ({
                    id: toolCall.id,
                    type: 'function',

                    function: {
                      name: toolCall.name,
                      arguments: JSON.stringify(toolCall.arguments),
                    },
                  })),
                }
              : {}),
          },
    ),
  ];
}

function openRouterMessages(req: ModelRequest) {
  return [
    {
      role: 'system',
      content: req.system,
    },

    ...req.messages.map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: message.toolCallId,
          content: message.content,
        };
      }

      let reasoningDetails: unknown;

      for (const toolCall of message.toolCalls ?? []) {
        reasoningDetails = decodeOpaque(
          OPENROUTER_REASONING_PREFIX,
          toolCall.signature,
        );

        if (reasoningDetails) break;
      }

      return {
        role: message.role,
        content: message.content || null,

        ...(reasoningDetails
          ? {
              reasoning_details: reasoningDetails,
            }
          : {}),

        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: 'function',

                function: {
                  name: toolCall.name,
                  arguments: JSON.stringify(toolCall.arguments),
                },
              })),
            }
          : {}),
      };
    }),
  ];
}

function anthropicMessages(req: ModelRequest) {
  const messages: {
    role: string;
    content: unknown[];
  }[] = [];

  for (const message of req.messages) {
    let content: unknown[];

    if (message.role === 'tool') {
      content = [
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: message.content,
        },
      ];
    } else {
      const thinkingBlocks: unknown[] = [];

      for (const toolCall of message.toolCalls ?? []) {
        const recovered = decodeOpaque(
          ANTHROPIC_THINKING_PREFIX,
          toolCall.signature,
        );

        if (Array.isArray(recovered)) {
          thinkingBlocks.push(...recovered);
          break;
        }
      }

      content = [
        ...thinkingBlocks,

        ...(message.content
          ? [
              {
                type: 'text',
                text: message.content,
              },
            ]
          : []),

        ...(message.toolCalls ?? []).map((toolCall) => ({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.arguments,
        })),
      ];
    }

    const role = message.role === 'tool' ? 'user' : message.role;
    const previous = messages.at(-1);

    if (previous?.role === role && Array.isArray(previous.content)) {
      previous.content.push(...content);
    } else {
      messages.push({
        role,
        content,
      });
    }
  }

  return messages;
}

function openAIResponseInput(req: ModelRequest): Record<string, unknown>[] {
  const input: Record<string, unknown>[] = [];

  for (const message of req.messages) {
    if (message.role === 'tool') {
      if (!message.toolCallId) {
        throw new Error(
          'OpenAI tool result is missing its function call ID.',
        );
      }

      input.push({
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: message.content,
      });

      continue;
    }

    /*
     * Responses API reasoning items need to be replayed during stateless
     * function-calling loops. AgentScope stores them inside ToolCall.signature.
     */
    for (const toolCall of message.toolCalls ?? []) {
      const recovered = decodeOpaque(
        OPENAI_REASONING_PREFIX,
        toolCall.signature,
      );

      if (Array.isArray(recovered)) {
        for (const item of recovered) {
          if (
            item &&
            typeof item === 'object' &&
            !Array.isArray(item)
          ) {
            input.push(item as Record<string, unknown>);
          }
        }

        break;
      }
    }

    if (message.content) {
      input.push({
        role: message.role,
        content: message.content,
      });
    }

    for (const toolCall of message.toolCalls ?? []) {
      input.push({
        type: 'function_call',
        call_id: toolCall.id,
        name: toolCall.name,
        arguments: JSON.stringify(toolCall.arguments),
      });
    }
  }

  return input;
}

/* -------------------------------------------------------------------------- */
/*                                  Usage                                     */
/* -------------------------------------------------------------------------- */

export function usage(
  model: Model,
  providerId: string,
  input: number | null,
  output: number | null,
  cached: number | null,
  unknownPricing = false,
): Usage {
  let cost: number | null = null;

  if (
    !unknownPricing &&
    input !== null &&
    output !== null &&
    model.inputPrice !== undefined &&
    model.outputPrice !== undefined
  ) {
    cost =
      ((input - (cached ?? 0)) * model.inputPrice +
        (cached ?? 0) * (model.cachedPrice ?? model.inputPrice) +
        output * model.outputPrice) /
      1e6;
  }

  return {
    input,
    output,
    cached,
    cost,
    providerId,
    modelId: model.id,
  };
}

/* -------------------------------------------------------------------------- */
/*                            Response body helper                            */
/* -------------------------------------------------------------------------- */

async function readResponseBody(
  response: Response,
  maxBytes = 16_000_000,
): Promise<string> {
  const reader = response.body?.getReader();

  if (!reader) {
    return '';
  }

  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const part = await reader.read();

      if (part.done) {
        break;
      }

      size += part.value.length;

      if (size > maxBytes) {
        throw new Error('Provider response exceeds the response limit.');
      }

      chunks.push(part.value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Body may already be closed.
    }
  }

  return Buffer.concat(chunks).toString('utf8');
}

/* -------------------------------------------------------------------------- */
/*                                Providers                                   */
/* -------------------------------------------------------------------------- */

export class Providers implements ProviderAdapter {
  constructor(
    private vault: Vault,
    private fetcher: typeof fetch = fetch,
  ) {}

  validate(provider: Provider): void {
    validateEndpoint(provider.baseUrl);
    providerHeaders(provider, this.vault);
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    req.signal.throwIfAborted();

    const { provider: p, model: m } = req;

    const base = validateEndpoint(p.baseUrl);

    const headers = providerHeaders(p, this.vault);

    let endpoint: string;
    let body: Record<string, unknown>;

    let ollamaMode: OllamaMode | null = null;
    let responseMode:
      | 'anthropic'
      | 'gemini'
      | 'ollama-native'
      | 'openai-responses'
      | 'openai-chat' = 'openai-chat';

    const toolsEnabled = !!m.tools && req.tools.length > 0;

    /* ---------------------------------------------------------------------- */
    /*                                Anthropic                               */
    /* ---------------------------------------------------------------------- */

    if (p.kind === 'anthropic') {
      responseMode = 'anthropic';

      endpoint = anthropicEndpoint(base);

      const reasoning = anthropicReasoningConfig(m);

      body = {
        model: m.id,
        max_tokens: m.maxOutput,
        system: req.system,
        messages: anthropicMessages(req),

        /*
         * Newer Claude reasoning models may reject sampling controls while
         * adaptive thinking is active, so only send temperature when no
         * explicit reasoning configuration is being used.
         */
        ...(!reasoning && m.temperature !== undefined
          ? {
              temperature: m.temperature,
            }
          : {}),

        ...(toolsEnabled
          ? {
              tools: req.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters,
              })),
            }
          : {}),

        ...(reasoning ?? {}),
      };

      /* -------------------------------------------------------------------- */
      /*                                  Gemini                              */
      /* -------------------------------------------------------------------- */
    } else if (p.kind === 'gemini') {
      responseMode = 'gemini';

      endpoint = geminiEndpoint(base, m.id);

      const thinkingConfig = geminiThinkingConfig(m);

      const contents = req.messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',

        parts:
          message.role === 'tool'
            ? [
                {
                  functionResponse: {
                    name: message.name ?? findToolName(req, message.toolCallId) ?? 'tool',

                    response: {
                      result: message.content,
                    },
                  },
                },
              ]
            : [
                ...(message.content
                  ? [
                      {
                        text: message.content,
                      },
                    ]
                  : []),

                ...(message.toolCalls ?? []).map((toolCall) => ({
                  functionCall: {
                    name: toolCall.name,
                    args: toolCall.arguments,
                  },

                  ...(toolCall.signature
                    ? {
                        thoughtSignature: toolCall.signature,
                      }
                    : {}),
                })),
              ],
      }));

      body = {
        systemInstruction: {
          parts: [
            {
              text: req.system,
            },
          ],
        },

        contents,

        generationConfig: {
          maxOutputTokens: m.maxOutput,

          ...(m.temperature !== undefined
            ? {
                temperature: m.temperature,
              }
            : {}),

          ...(thinkingConfig
            ? {
                thinkingConfig,
              }
            : {}),
        },

        ...(toolsEnabled
          ? {
              tools: [
                {
                  functionDeclarations: req.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parametersJsonSchema: tool.parameters,
                  })),
                },
              ],
            }
          : {}),
      };

      /* -------------------------------------------------------------------- */
      /*                                  Ollama                              */
      /* -------------------------------------------------------------------- */
    } else if (p.kind === 'ollama') {
      const resolved = ollamaEndpoint(base);

      endpoint = resolved.endpoint;
      ollamaMode = resolved.mode;

      if (ollamaMode === 'native') {
        responseMode = 'ollama-native';

        const think = ollamaThinking(m);

        body = {
          model: m.id,
          messages: ollamaMessages(req),
          stream: false,

          ...(think !== undefined
            ? {
                think,
              }
            : {}),

          options: {
            num_ctx: m.contextSize,
            num_predict: m.maxOutput,

            ...(m.temperature !== undefined
              ? {
                  temperature: m.temperature,
                }
              : {}),
          },

          ...(toolsEnabled
            ? {
                tools: req.tools.map((tool) => ({
                  type: 'function',

                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  },
                })),
              }
            : {}),
        };
      } else {
        responseMode = 'openai-chat';

        body = {
          model: m.id,
          messages: openAIMessages(req),
          max_tokens: m.maxOutput,

          ...(m.temperature !== undefined
            ? {
                temperature: m.temperature,
              }
            : {}),

          ...(toolsEnabled
            ? {
                tools: req.tools.map((tool) => ({
                  type: 'function',
                  function: tool,
                })),
              }
            : {}),
        };
      }

      /* -------------------------------------------------------------------- */
      /*                                  OpenAI                              */
      /* -------------------------------------------------------------------- */
    } else if (p.kind === 'openai') {
      responseMode = 'openai-responses';

      endpoint = openAIResponsesEndpoint(base);

      const reasoning = openAIReasoningConfig(m);

      body = {
        model: m.id,
        instructions: req.system,
        input: openAIResponseInput(req),

        max_output_tokens: m.maxOutput,

        /*
         * AgentScope keeps its own conversation state, so use stateless
         * Responses requests and replay required reasoning/tool items.
         */
        store: false,

        ...(reasoning
          ? {
              reasoning,
            }
          : {}),

        /*
         * GPT reasoning models can reject temperature while reasoning is
         * active. For reliability we intentionally do not send temperature
         * through the native OpenAI Responses adapter.
         */

        ...(toolsEnabled
          ? {
              tools: req.tools.map((tool) => ({
                type: 'function',
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              })),

              /*
               * This lets us replay reasoning items during stateless
               * tool-call loops.
               */
              include: ['reasoning.encrypted_content'],
            }
          : {}),
      };

      /* -------------------------------------------------------------------- */
      /*                                OpenRouter                            */
      /* -------------------------------------------------------------------- */
    } else if (p.kind === 'openrouter') {
      responseMode = 'openai-chat';

      endpoint = openRouterEndpoint(base);

      const reasoning = openRouterReasoningConfig(m);

      body = {
        model: m.id,
        messages: openRouterMessages(req),
        max_tokens: m.maxOutput,

        ...(m.temperature !== undefined
          ? {
              temperature: m.temperature,
            }
          : {}),

        ...(reasoning
          ? {
              reasoning,
            }
          : {}),

        ...(toolsEnabled
          ? {
              tools: req.tools.map((tool) => ({
                type: 'function',
                function: tool,
              })),
            }
          : {}),
      };

      /* -------------------------------------------------------------------- */
      /*                           Generic OpenAI-compatible                  */
      /* -------------------------------------------------------------------- */
    } else {
      responseMode = 'openai-chat';

      endpoint = openAIChatEndpoint(base);

      /*
       * Custom/OpenAI-compatible providers vary wildly in which proprietary
       * reasoning parameters they accept. Deliberately use only the common
       * Chat Completions fields here.
       */
      body = {
        model: m.id,
        messages: openAIMessages(req),
        max_tokens: m.maxOutput,

        ...(m.temperature !== undefined
          ? {
              temperature: m.temperature,
            }
          : {}),

        ...(toolsEnabled
          ? {
              tools: req.tools.map((tool) => ({
                type: 'function',
                function: tool,
              })),
            }
          : {}),
      };
    }

    /* ---------------------------------------------------------------------- */
    /*                                Request                                 */
    /* ---------------------------------------------------------------------- */

    const signal = AbortSignal.any([
      req.signal,
      AbortSignal.timeout(180_000),
    ]);

    let response: Response;

    try {
      response = await this.fetcher(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
        redirect: 'error',
      });
    } catch (error) {
      req.signal.throwIfAborted();

      throw new Error(
        `Provider connection failed: ${this.vault.redact(
          error instanceof Error ? error.message : 'network error',
        )}`,
      );
    }

    /*
     * IMPORTANT:
     * Read provider errors instead of cancelling their body. This is the
     * difference between:
     *
     *   "HTTP 400"
     *
     * and:
     *
     *   "HTTP 400: reasoning_effort is unsupported"
     */
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new Error(authenticationFailure(p, endpoint, response.status, headers));
      }
      let providerError = '';

      try {
        const error: unknown = JSON.parse(await readResponseBody(response, 1_000_000));
        const parsed = z.object({error: z.union([z.string(), z.object({message:z.string().optional(),code:z.union([z.string(),z.number()]).optional()})]).optional()}).safeParse(error);
        if (parsed.success) providerError = typeof parsed.data.error === 'string' ? parsed.data.error : (parsed.data.error?.message ?? '');
      } catch {
        providerError = '';
      }

      const path = new URL(endpoint).pathname;

      const safeError = providerError
        ? this.vault.redact(providerError).slice(0, 4_000)
        : '';

      throw new Error(
        `Provider returned HTTP ${response.status} at ${path}${
          safeError ? `: ${safeError}` : ''
        }`,
      );
    }

    const raw = await readResponseBody(response);

    if (!raw) {
      throw new Error('Provider returned an empty body.');
    }

    let json: unknown;

    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error(
        `Provider returned invalid JSON: ${this.vault
          .redact(raw)
          .slice(0, 1_000)}`,
      );
    }

    /* ---------------------------------------------------------------------- */
    /*                               Anthropic                                */
    /* ---------------------------------------------------------------------- */

    if (responseMode === 'anthropic') {
      const data = anthropicResponse.parse(json);
      const u = data.usage;

      const thinkingBlocks = data.content
        .filter((content) => content.type === 'thinking')
        .map((content) => ({
          type: 'thinking',
          thinking: content.thinking,
          signature: content.signature,
        }));

      const thinkingSignature = thinkingBlocks.length
        ? encodeOpaque(ANTHROPIC_THINKING_PREFIX, thinkingBlocks)
        : undefined;

      return {
        text: data.content
          .filter((content) => content.type === 'text')
          .map((content) => content.text)
          .join('\n'),

        toolCalls: data.content
          .filter((content) => content.type === 'tool_use')
          .map((content) => ({
            id: content.id,
            name: content.name,
            arguments: content.input,

            ...(thinkingSignature
              ? {
                  signature: thinkingSignature,
                }
              : {}),
          })),

        usage: usage(
          m,
          p.id,

          u
            ? u.input_tokens +
                (u.cache_read_input_tokens ?? 0) +
                (u.cache_creation_input_tokens ?? 0)
            : null,

          u?.output_tokens ?? null,
          u?.cache_read_input_tokens ?? null,

          !!u?.cache_creation_input_tokens,
        ),

        finishReason: data.stop_reason ?? 'unknown',
      };
    }

    /* ---------------------------------------------------------------------- */
    /*                                 Gemini                                 */
    /* ---------------------------------------------------------------------- */

    if (responseMode === 'gemini') {
      const data = geminiResponse.parse(json);
      const candidate = data.candidates?.[0];
      const u = data.usageMetadata;

      if (!candidate?.content) {
        throw new Error(
          'Gemini returned no content. Check provider safety or model response details.',
        );
      }

      return {
        text: candidate.content.parts
          .filter((part) => !part.thought)
          .map((part) => part.text ?? '')
          .join(''),

        toolCalls: candidate.content.parts.flatMap((part) =>
          part.functionCall
            ? [
                {
                  id: crypto.randomUUID(),
                  name: part.functionCall.name,
                  arguments: part.functionCall.args,
                  signature: part.thoughtSignature,
                },
              ]
            : [],
        ),

        usage: usage(
          m,
          p.id,

          u?.promptTokenCount ?? null,

          u?.candidatesTokenCount !== undefined
            ? u.candidatesTokenCount + (u.thoughtsTokenCount ?? 0)
            : null,

          u?.cachedContentTokenCount ?? null,
        ),

        finishReason: candidate.finishReason ?? 'unknown',
      };
    }

    /* ---------------------------------------------------------------------- */
    /*                             Native Ollama                              */
    /* ---------------------------------------------------------------------- */

    if (responseMode === 'ollama-native') {
      const data = ollamaResponse.parse(json);

      const toolCalls: ToolCall[] = (data.message.tool_calls ?? []).map(
        (toolCall) => ({
          id: crypto.randomUUID(),
          name: toolCall.function.name,
          arguments: parseToolArguments(toolCall.function.arguments),
        }),
      );

      return {
        text: data.message.content ?? '',
        toolCalls,

        usage: usage(
          m,
          p.id,
          data.prompt_eval_count ?? null,
          data.eval_count ?? null,
          null,
        ),

        finishReason:
          data.done_reason ?? (toolCalls.length ? 'tool_calls' : 'stop'),
      };
    }

    /* ---------------------------------------------------------------------- */
    /*                           OpenAI Responses API                         */
    /* ---------------------------------------------------------------------- */

    if (responseMode === 'openai-responses') {
      const data = openAIResponsesResponse.parse(json);
      const u = data.usage;

      const reasoningItems = data.output.filter(
        (item) => item.type === 'reasoning',
      );

      const reasoningSignature = reasoningItems.length
        ? encodeOpaque(OPENAI_REASONING_PREFIX, reasoningItems)
        : undefined;

      const toolCalls: ToolCall[] = [];
      const text: string[] = [];

      for (const item of data.output) {
        if (item.type === 'function_call') {
          const callId = item.call_id;
          const name = item.name;
          const argumentsValue = item.arguments;

          if (
            typeof callId === 'string' &&
            typeof name === 'string' &&
            typeof argumentsValue === 'string'
          ) {
            toolCalls.push({
              /*
               * function_call_output expects call_id, so expose call_id as
               * AgentScope's ToolCall.id.
               */
              id: callId,
              name,
              arguments: parseFunctionArguments(argumentsValue),

              ...(reasoningSignature
                ? {
                    signature: reasoningSignature,
                  }
                : {}),
            });
          }

          continue;
        }

        if (item.type !== 'message') {
          continue;
        }

        const content = item.content;

        if (!Array.isArray(content)) {
          continue;
        }

        for (const part of content) {
          if (
            part &&
            typeof part === 'object' &&
            !Array.isArray(part)
          ) {
            const record = part as Record<string, unknown>;

            if (
              record.type === 'output_text' &&
              typeof record.text === 'string'
            ) {
              text.push(record.text);
            }
          }
        }
      }

      let finishReason: string;

      if (toolCalls.length) {
        finishReason = 'tool_calls';
      } else if (data.status === 'completed') {
        finishReason = 'stop';
      } else if (data.incomplete_details?.reason) {
        finishReason = data.incomplete_details.reason;
      } else {
        finishReason = data.status ?? 'unknown';
      }

      return {
        text: text.join(''),
        toolCalls,

        usage: usage(
          m,
          p.id,
          u?.input_tokens ?? null,
          u?.output_tokens ?? null,
          u?.input_tokens_details?.cached_tokens ?? null,
        ),

        finishReason,
      };
    }

    /* ---------------------------------------------------------------------- */
    /*                     OpenAI-compatible Chat Completions                 */
    /* ---------------------------------------------------------------------- */

    const data = openAIChatResponse.parse(json);
    const choice = data.choices[0];

    if (!choice) {
      throw new Error('Provider returned no choices.');
    }

    let reasoningSignature: string | undefined;

    if (p.kind === 'openrouter' && choice.message.reasoning_details?.length) {
      reasoningSignature = encodeOpaque(
        OPENROUTER_REASONING_PREFIX,
        choice.message.reasoning_details,
      );
    }

    return {
      text: choice.message.content ?? '',

      toolCalls: (choice.message.tool_calls ?? []).map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: parseFunctionArguments(toolCall.function.arguments),

        ...(reasoningSignature
          ? {
              signature: reasoningSignature,
            }
          : {}),
      })),

      usage: usage(
        m,
        p.id,
        data.usage?.prompt_tokens ?? null,
        data.usage?.completion_tokens ?? null,
        data.usage?.prompt_tokens_details?.cached_tokens ?? null,
      ),

      finishReason: choice.finish_reason ?? 'unknown',
    };
  }
}
