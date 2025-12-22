/** HYPER GENERATOR
 * License: MIT; Credit to OccultSage for the original form and inspiration
 * Authors: Keilla
 * Version: 0.1.1
 */

// ===== CONSTANTS =====

const DEFAULT_GENERATE_OPTIONS = {
  maxRetries: 5,
  maxTokens: 250,
  minTokens: 50,
  maxContinuations: 20,
  continuationPrompt:
    "Your response was cut off. Continue exactly where you stopped. Do not repeat any content, do not start over, do not repeat headers.",
};

const API_GENERATE_LIMIT = 1024;

// ===== TYPES =====

export type HyperGenerationParams = Partial<GenerationParams> & {
  /**
   * Maximum output tokens. Can exceed the default limits imposed by api.v1.generate,
   * and will continue output until this is reached.
   */
  maxTokens: number;
  /** Set a minimum number of tokens to return. Used to evade spurious stoppage from the model. */
  minTokens: number;
  /** Max retry attempts for transient errors */
  maxRetries?: number;
  /** Max continuations for length cutoffs */
  maxContinuations?: number;
  /** Prompt to send for continuations */
  continuationPrompt?: string;
  /**
   * Callback invoked when waiting for token budget.
   * Called with (available, needed, time) before blocking on waitForAllowedOutput.
   */
  onBudgetWait?: OnBudgetWaitCallback;
  /**
   * Callback invoked when token budget becomes available after waiting.
   * Called with (available) after waitForAllowedOutput resolves.
   */
  onBudgetResume?: OnBudgetResumeCallback;
};

export interface OnBudgetWaitCallback {
  (available: number, needed: number, time: number): boolean | Promise<void>;
}

export interface OnBudgetResumeCallback {
  (available: number): void | Promise<void>;
}

// ===== ERROR HANDLING =====

class TransientError extends Error {}

function isTransientError(e: unknown): boolean {
  const msg =
    e instanceof Error
      ? e.message
      : e && typeof e === "object" && "message" in e
        ? String((e as { message: unknown }).message)
        : "";
  const lower = msg.toLowerCase();
  return (
    lower.includes("aborted") ||
    lower.includes("fetch") ||
    lower.includes("network") ||
    lower.includes("timeout")
  );
}
// == Utility

/**
 * Ensures sufficient output token budget before generation.
 * Waits if necessary, returns the effective max_tokens to use.
 *
 * @param requestedTokens The desired max_tokens
 * @param minTokens Minimum acceptable tokens (wait if below this)
 * @param logPrefix Prefix for log messages
 * @param onBudgetWait Optional callback invoked before waiting
 * @param onBudgetResume Optional callback invoked after waiting completes
 * @returns Effective max_tokens to use (may be less than requested but >= min)
 */
async function ensureOutputBudget(
  requestedTokens: number,
  onBudgetWait?: OnBudgetWaitCallback,
  onBudgetResume?: (available: number) => void | Promise<void>,
): Promise<number> {
  let available = api.v1.script.getAllowedOutput();

  if (available < requestedTokens) {
    hyperLog(
      `Insufficient output budget. Have ${available}, need ${requestedTokens}. Waiting...`,
    );
    const time = api.v1.script.getTimeUntilAllowedOutput(requestedTokens);
    await onBudgetWait?.(available, requestedTokens, time);
    await api.v1.script.waitForAllowedOutput(requestedTokens);
    available = api.v1.script.getAllowedOutput();
    hyperLog(`Budget available: ${available} tokens`);
    await onBudgetResume?.(available);
  }

  const effectiveTokens = Math.min(requestedTokens, available);
  if (effectiveTokens < requestedTokens) {
    hyperLog(
      `Using reduced budget: ${effectiveTokens} (requested ${requestedTokens})`,
    );
  }

  return effectiveTokens;
}

function sliceGenerateParams(params: HyperGenerationParams): GenerationParams {
  const {
    model,
    temperature,
    top_p,
    top_k,
    min_p,
    frequency_penalty,
    presence_penalty,
    stop,
    logit_bias,
    enable_thinking,
  } = params;
  return {
    model,
    temperature,
    top_p,
    top_k,
    min_p,
    frequency_penalty,
    presence_penalty,
    stop,
    logit_bias,
    enable_thinking,
  } as GenerationParams;
}

function hyperLog(...args: any[]) {
  api.v1.log("[hyperGenerate]", ...args);
}

// ===== UI =====

export function createContinueModalCallback(
  signal: CancellationSignal,
): OnBudgetWaitCallback {
  return async (available, requestedTokens, time) =>
    await showContinueModal(available, requestedTokens, time, signal);
}

async function showContinueModal(
  available: number,
  requestedTokens: number,
  time: number,
  signal?: CancellationSignal,
) {
  const modal = await api.v1.ui.modal.open({
    title: "Generation Paused",
    size: "small",
    content: [
      api.v1.ui.part.text({
        text: `**Currently:** ${available}/${requestedTokens}\nMore tokens in ${time / 1000} seconds.`,
        markdown: true,
      }),
      api.v1.ui.part.text({
        text: "Generation limit reached. Continue?",
      }),
      api.v1.ui.part.row({
        content: [
          api.v1.ui.part.button({
            text: "Continue",
            callback: () => {
              modal.close();
            },
          }),
          api.v1.ui.part.button({
            text: "Stop",
            callback: () => {
              if (signal) signal.cancel();
              modal.close();
            },
          }),
        ],
        spacing: "space-between",
      }),
    ],
  });
}

// ===== MAIN GENERATION FUNCTION =====

/**
 * hyperGenerate is a wrapper aroun api.v1.generate that allows for a much
 * higher maximum number of tokens by utilizing a recursive retrying strategy.
 * Keeps on generating as long as user can keep plugging the continue button.
 * Also retries connection drops, output budgets, and spurious stop tokens.
 *
 * @param messages Messages expected by api.v1.generate
 * @param params api.v1.generate parameters extended with additional parameters to control hyper generation
 * @param callback Optional streaming callback. Accumulates GenerationChoice[0] and emits GenerationChoice[] when a newline is received.
 * @param behaviour "background" or "blocking".
 * @param signal Cancellation signal for stopping generation.
 * @returns A promise of api.v1.generate respones.
 */
export async function hyperGenerate(
  messages: Message[],
  params: HyperGenerationParams,
  callback: (choices: GenerationChoice[], final: boolean) => void = () => {},
  behaviour?: "background" | "blocking",
  signal?: CancellationSignal,
): Promise<GenerationResponse[]> {
  const generationParams = await api.v1.generationParameters.get();
  const ensuredParams = {
    ...generationParams,
    ...DEFAULT_GENERATE_OPTIONS,
    ...params,
  };

  let systemMessage = messages.find((m) => m.role == "system");
  const systemMessageTokens = systemMessage?.content
    ? (
        await api.v1.tokenizer.encode(
          systemMessage.content,
          ensuredParams.model,
        )
      ).length
    : 0;
  const modelMaxTokens = await api.v1.maxTokens(ensuredParams.model);
  const rolloverHelper = api.v1.createRolloverHelper({
    maxTokens: modelMaxTokens - systemMessageTokens,
    rolloverTokens: 0,
    model: ensuredParams.model,
  });

  const contextMessages = messages.filter(
    (m) => m.content != undefined && m.role != "system",
  ) as RolloverHelperContentObject[];

  await rolloverHelper.add(contextMessages);

  let remainingTokens = ensuredParams.maxTokens;
  let remainingContinuations = ensuredParams.maxContinuations;
  let accumulatedResponses: GenerationResponse[] = [];
  let accumulatedChoices: GenerationChoice[] = [];

  const paragraphStreamer =
    callback === undefined
      ? undefined
      : (choices: GenerationChoice[], final: boolean) => {
          accumulatedChoices.push(choices[0]);
          if (choices[0].text.endsWith("\n")) {
            callback(accumulatedChoices, final);
            accumulatedChoices = [];
          }
        };

  hyperLog(
    `hyperGenerate beginning loop for ${remainingTokens} Tokens, ${remainingContinuations} Continuations.`,
  );

  while (remainingTokens > 0 && remainingContinuations > 0) {
    hyperLog(
      `hyperGenerate... ${remainingTokens} Tokens, ${remainingContinuations} Continuations.`,
    );
    const context: Message[] = [
      ...(systemMessage !== undefined ? [systemMessage] : []),
      ...(rolloverHelper.read() as unknown as Message[]),
      ...(remainingContinuations < ensuredParams.maxContinuations
        ? [
            {
              role: "user",
              content: ensuredParams.continuationPrompt,
            } as Message,
          ]
        : []),
    ];

    const sample = context.reduce(
      (a, b): string => (b.content ? a + b.content : a),
      "",
    );
    hyperLog(
      "Context sample:",
      `${sample.slice(0, 40)} ... ${sample.slice(-350)}`,
    );

    const response = await generateWithRetry(
      context,
      {
        ...ensuredParams,
        maxTokens: remainingTokens,
      },
      paragraphStreamer,
      behaviour,
      signal,
    );
    accumulatedChoices = []; // Generation finished. Clear anything held in the streaming response buffer.

    const trimmedResponseText = (response.choices[0].text =
      response.choices[0].text.replace(/\n.*$/, "") + "\n");
    const trimmedResponseTokens = await api.v1.tokenizer.encode(
      trimmedResponseText,
      ensuredParams.model,
    );

    remainingTokens = remainingTokens - trimmedResponseTokens.length;
    remainingContinuations = remainingContinuations - 1;

    const { finish_reason } = response.choices[0];

    if (
      finish_reason === "stop" &&
      ensuredParams.maxTokens - remainingTokens < ensuredParams.minTokens
    ) {
      hyperLog("Stop generation after minTokens reached with stop.");
      break;
    }

    await rolloverHelper.add({
      role: "assistant",
      content: trimmedResponseText,
    });
    accumulatedResponses.push(response);
  }
  hyperLog(`hyperGenerate finished.`);

  return accumulatedResponses;
}

/**
 * A wrapper around hyperGenerate that reduces the generation responses to a single string.
 * @param messages Messages expected by api.v1.generate
 * @param params api.v1.generate parameters extended with additional parameters to control hyper generation
 * @param callback Optional streaming callback. Emits paragraphs instead of individual tokens.
 * @param behaviour "background" or "blocking".
 * @param signal Cancellation signal for stopping generation.
 * @returns Promise of generated text.
 */
export async function hyperGenerateText(
  messages: Message[],
  params: HyperGenerationParams,
  callback: (text: string, final: boolean) => void = () => {},
  behaviour?: "background" | "blocking",
  signal?: CancellationSignal,
): Promise<string> {
  const textStreamer =
    callback === undefined
      ? callback
      : (choices: GenerationChoice[], final: boolean) =>
          callback(
            choices.reduce((a, c) => a + c.text, ""),
            final,
          );

  return (
    await hyperGenerate(messages, params, textStreamer, behaviour, signal)
  ).reduce((a, b) => [a, b.choices[0].text].join("\n"), "");
}

/**
 * Generate function that retries when there are transient errors.
 *
 * @param messages Messages expected by api.v1.generate
 * @param params api.v1.generate parameters extended with additional parameters to control hyper generation
 * @param callback Optional streaming callback. Emits paragraphs instead of individual tokens.
 * @param behaviour "background" or "blocking".
 * @param signal Cancellation signal for stopping generation.
 * @returns A Promise of an api.v1.generateResponse
 */
async function generateWithRetry(
  messages: Message[],
  params: HyperGenerationParams,
  callback: (choices: GenerationChoice[], final: boolean) => void = () => {},
  behaviour?: "background" | "blocking",
  signal?: CancellationSignal,
): Promise<GenerationResponse> {
  const max_tokens = await ensureOutputBudget(
    params.maxTokens
      ? Math.min(params.maxTokens, API_GENERATE_LIMIT)
      : API_GENERATE_LIMIT,
    params.onBudgetWait,
    params.onBudgetResume,
  );

  try {
    hyperLog(`Generating ${max_tokens} tokens...`);
    return api.v1.generate(
      [...messages],
      {
        ...sliceGenerateParams(params),
        max_tokens,
      },
      callback,
      behaviour,
      signal,
    );
  } catch (e: any) {
    if (isTransientError(e) || /in progress/.test(e.message)) {
      if (params.maxRetries && params.maxRetries > 0) {
        await api.v1.timers.sleep(2000 ** (5 - params.maxRetries));
        return generateWithRetry(
          messages,
          { ...params, maxRetries: params.maxRetries - 1 },
          callback,
          behaviour,
          signal,
        );
      } else {
        throw new TransientError(
          "[generateWithRetry] Transient error encountered and retries exhausted.",
        );
      }
    } else {
      throw e;
    }
  }
}
