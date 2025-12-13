// ===== SHARED GENERATION UTILITIES =====
// Common generation infrastructure used by both world-map-generator and scenario-generator

// ===== CONSTANTS =====

export const GENERATION_LIMIT_ERROR = "Non-interactive generation limit reached.";

// ===== TYPES =====

export interface GenerateOptions {
    /** Streaming callback - receives text chunks as they arrive */
    onToken?: (text: string, final: boolean) => void;
    /** Max retry attempts for transient errors */
    maxRetries?: number;
    /** Whether to auto-continue on length cutoff */
    autoContinue?: boolean;
    /** Max continuations for length cutoffs */
    maxContinuations?: number;
    /** Prompt to send for continuations */
    continuationPrompt?: string;
    /** Whether to trim incomplete lines before continuing */
    trimIncomplete?: boolean;
    /** 
     * Minimum acceptable output tokens. If available budget < minOutputTokens, wait.
     * If >= minOutputTokens but < max_tokens, generate with available budget.
     * Defaults to max_tokens (require full budget).
     */
    minOutputTokens?: number;
    /**
     * Callback invoked when waiting for token budget.
     * Called with (available, needed) before blocking on waitForAllowedOutput.
     */
    onBudgetWait?: (available: number, needed: number) => void | Promise<void>;
    /**
     * Callback invoked when token budget becomes available after waiting.
     * Called with (available) after waitForAllowedOutput resolves.
     */
    onBudgetResume?: (available: number) => void | Promise<void>;
}

const DEFAULT_GENERATE_OPTIONS = {
    onToken: () => {},
    maxRetries: 5,
    autoContinue: true,
    maxContinuations: 20,
    continuationPrompt: 'Your response was cut off. Continue exactly where you stopped. Do not repeat any content, do not start over, do not repeat headers.',
    trimIncomplete: true,
    minOutputTokens: undefined as number | undefined,
};

// ===== ERROR HANDLING =====

export function isTransientError(e: unknown): boolean {
    const msg = e instanceof Error 
        ? e.message 
        : (e && typeof e === 'object' && 'message' in e) 
            ? String((e as {message: unknown}).message) 
            : '';
    const lower = msg.toLowerCase();
    return lower.includes('aborted') || 
           lower.includes('fetch') || 
           lower.includes('network') ||
           lower.includes('timeout');
}

/** Detect context overflow error (prompt too long for model) */
export function isContextOverflowError(e: unknown): boolean {
    const msg = e instanceof Error 
        ? e.message 
        : (e && typeof e === 'object' && 'message' in e) 
            ? String((e as {message: unknown}).message) 
            : '';
    const lower = msg.toLowerCase();
    return lower.includes('too much context') || 
           (lower.includes('invalid prompt') && lower.includes('context')) ||
           (lower.includes('400') && lower.includes('context'));
}

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
    minTokens: number,
    logPrefix: string,
    onBudgetWait?: (available: number, needed: number) => void | Promise<void>,
    onBudgetResume?: (available: number) => void | Promise<void>
): Promise<number> {
    let available = api.v1.script.getAllowedOutput();
    
    if (available < minTokens) {
        api.v1.log(`${logPrefix} Insufficient output budget. Have ${available}, need ${minTokens}. Waiting...`);
        await onBudgetWait?.(available, minTokens);
        await api.v1.script.waitForAllowedOutput(minTokens);
        available = api.v1.script.getAllowedOutput();
        api.v1.log(`${logPrefix} Budget available: ${available} tokens`);
        await onBudgetResume?.(available);
    }
    
    const effectiveTokens = Math.min(requestedTokens, available);
    if (effectiveTokens < requestedTokens) {
        api.v1.log(`${logPrefix} Using reduced budget: ${effectiveTokens} (requested ${requestedTokens})`);
    }
    
    return effectiveTokens;
}

/**
 * Trim oldest user-assistant pairs from message history (preserving system message).
 * Useful when hitting context limits.
 * @returns The number of pairs removed
 */
export function trimOldestMessagePairs(messages: Message[], pairsToRemove: number): number {
    // Find where user-assistant pairs start (after system messages)
    let firstUserIdx = 0;
    while (firstUserIdx < messages.length && messages[firstUserIdx].role === 'system') {
        firstUserIdx++;
    }
    
    // Count available pairs (user + assistant = 2 messages per pair)
    const availableMessages = messages.length - firstUserIdx;
    const availablePairs = Math.floor(availableMessages / 2);
    
    // Can't trim more pairs than we have (keep at least 1 pair for current request)
    const actualPairsToRemove = Math.min(pairsToRemove, availablePairs - 1);
    
    if (actualPairsToRemove <= 0) {
        return 0;
    }
    
    // Remove pairs starting from the oldest (right after system messages)
    const messagesToRemove = actualPairsToRemove * 2;
    messages.splice(firstUserIdx, messagesToRemove);
    
    return actualPairsToRemove;
}

// ===== UI =====

export async function showContinueModal(progressInfo: string): Promise<boolean> {
    return new Promise(async (resolve) => {
        const modal = await api.v1.ui.modal.open({
            title: "Generation Paused",
            size: "small",
            content: [
                api.v1.ui.part.text({ 
                    text: `**Currently:** ${progressInfo}`,
                    markdown: true 
                }),
                api.v1.ui.part.text({ 
                    text: "Generation limit reached. Continue?" 
                }),
                api.v1.ui.part.row({
                    content: [
                        api.v1.ui.part.button({
                            text: "Continue",
                            callback: () => {
                                resolve(true);
                                modal.close();
                            }
                        }),
                        api.v1.ui.part.button({
                            text: "Stop",
                            callback: () => {
                                resolve(false);
                                modal.close();
                            }
                        })
                    ],
                    spacing: "space-between"
                })
            ]
        });
        
        modal.closed.then(() => resolve(false));
    });
}

// ===== MAIN GENERATION FUNCTION =====

/**
 * Robust generation function with:
 * - Optional streaming callback
 * - Generation limit handling (shows modal)
 * - Transient error retry with exponential backoff
 * - Auto-continuation for length cutoffs
 * 
 * Returns the complete generated text.
 */
export async function robustGenerate(
    messages: Message[],
    params: GenerationParams,
    progressInfo: string,
    options?: GenerateOptions
): Promise<string> {
    const opts = { ...DEFAULT_GENERATE_OPTIONS, ...options };
    const requestedTokens = params.max_tokens ?? 1024;
    const minTokens = opts.minOutputTokens ?? requestedTokens;
    
    let attempts = 0;
    let continuations = 0;
    let accumulatedText = '';
    let workingMessages = [...messages];
    
    api.v1.log(`[robustGenerate] Starting: ${progressInfo}, max_tokens: ${requestedTokens}, minOutputTokens: ${minTokens}, autoContinue: ${opts.autoContinue}`);
    
    while (true) {
        try {
            // Ensure we have sufficient output budget before generating
            const effectiveMaxTokens = await ensureOutputBudget(requestedTokens, minTokens, '[robustGenerate]', opts.onBudgetWait, opts.onBudgetResume);
            const effectiveParams = { ...params, max_tokens: effectiveMaxTokens };
            
            // Use streaming callback if provided
            let responseText = '';
            const streamCallback = opts.onToken ? (choices: GenerationChoice[], final: boolean) => {
                responseText += choices[0].text;
                opts.onToken!(accumulatedText + responseText, final);
            } : undefined;
            
            const response = streamCallback 
                ? await api.v1.generate(workingMessages, effectiveParams, streamCallback)
                : await api.v1.generate(workingMessages, effectiveParams);
            
            // If not streaming, get text from response
            if (!streamCallback) {
                responseText = response.choices[0].text;
            }
            
            const finishReason = response.choices[0].finish_reason;
            api.v1.log(`[robustGenerate] Call ${continuations + 1}: finish_reason=${finishReason}, responseText.length=${responseText.length}`);
            api.v1.log(`[robustGenerate] Response preview: "${responseText.substring(0, 100)}..."`);
            api.v1.log(`[robustGenerate] Response tail: "...${responseText.substring(Math.max(0, responseText.length - 100))}"`);
            
            // Handle length cutoff or connection drop with auto-continuation
            if ((finishReason === 'length' || finishReason === null) && opts.autoContinue && continuations < opts.maxContinuations) {
                continuations++;
                api.v1.log(`[robustGenerate] Cutoff detected (reason: ${finishReason}). Continuation ${continuations}/${opts.maxContinuations}`);
                
                let textToAccumulate = responseText;
                
                // Optionally trim the last potentially incomplete line
                if (opts.trimIncomplete) {
                    const lastNewlineIndex = responseText.lastIndexOf('\n');
                    textToAccumulate = lastNewlineIndex > 0 
                        ? responseText.substring(0, lastNewlineIndex + 1)
                        : responseText;
                    api.v1.log(`[robustGenerate] Trimmed ${responseText.length - textToAccumulate.length} chars from incomplete line`);
                }
                
                accumulatedText += textToAccumulate;
                api.v1.log(`[robustGenerate] Accumulated so far: ${accumulatedText.length} chars`);
                
                // Reset to original messages plus accumulated response and continuation prompt
                workingMessages = [...messages];
                workingMessages.push({ role: 'assistant', content: accumulatedText });
                workingMessages.push({ role: 'user', content: opts.continuationPrompt });
                
                api.v1.log(`[robustGenerate] Continuation prompt: "${opts.continuationPrompt}"`);
                
                // Continue the loop to generate more
                continue;
            }
            
            // If we accumulated text from continuations, combine with final response
            if (accumulatedText) {
                const finalText = accumulatedText + responseText;
                api.v1.log(`[robustGenerate] Combining: accumulated(${accumulatedText.length}) + final(${responseText.length}) = ${finalText.length} chars`);
                return finalText;
            }
            
            api.v1.log(`[robustGenerate] Complete. Total continuations: ${continuations}, final length: ${responseText.length}, finish_reason: ${finishReason}`);
            return responseText;
            
        } catch (e) {
            if (e instanceof Error && e.message === GENERATION_LIMIT_ERROR) {
                api.v1.log(`[robustGenerate] Generation limit hit. Showing continue modal.`);
                const shouldContinue = await showContinueModal(progressInfo);
                if (!shouldContinue) {
                    // Return what we have so far, or throw
                    if (accumulatedText) {
                        api.v1.log(`[robustGenerate] Cancelled, returning partial: ${accumulatedText.length} chars`);
                        return accumulatedText;
                    }
                    throw new Error("User cancelled generation");
                }
            } else if (isTransientError(e) && attempts < opts.maxRetries) {
                attempts++;
                const errorMsg = e instanceof Error ? e.message : JSON.stringify(e);
                api.v1.log(`[robustGenerate] Transient error (attempt ${attempts}/${opts.maxRetries}): ${errorMsg}. Retrying...`);
                await api.v1.timers.sleep(1000 * attempts);
            } else {
                api.v1.log(`[robustGenerate] Fatal error: ${e instanceof Error ? e.message : JSON.stringify(e)}`);
                throw e;
            }
        }
    }
}

/**
 * Wrapper that returns the full GenerationResponse object.
 * Use this when you need access to finish_reason or other response metadata.
 * 
 * Note: Does not support streaming (use robustGenerate for that).
 */
export async function robustGenerateResponse(
    messages: Message[],
    params: GenerationParams,
    progressInfo: string,
    options?: Omit<GenerateOptions, 'onToken'>
): Promise<GenerationResponse> {
    const opts = { ...DEFAULT_GENERATE_OPTIONS, ...options, onToken: undefined };
    const requestedTokens = params.max_tokens ?? 1024;
    const minTokens = opts.minOutputTokens ?? requestedTokens;

    let attempts = 0;
    let continuations = 0;
    let accumulatedText = '';
    let workingMessages = [...messages];
    
    api.v1.log(`[robustGenerateResponse] Starting: ${progressInfo}, max_tokens: ${requestedTokens}, minOutputTokens: ${minTokens}, autoContinue: ${opts.autoContinue}`);
    
    while (true) {
        try {
            // Ensure we have sufficient output budget before generating
            const effectiveMaxTokens = await ensureOutputBudget(requestedTokens, minTokens, '[robustGenerateResponse]', opts.onBudgetWait, opts.onBudgetResume);
            const effectiveParams = { ...params, max_tokens: effectiveMaxTokens };
            
            const response = await api.v1.generate(workingMessages, effectiveParams);
            const finishReason = response.choices[0].finish_reason;
            const responseText = response.choices[0].text;
            
            api.v1.log(`[robustGenerateResponse] Call ${continuations + 1}: finish_reason=${finishReason}, responseText.length=${responseText.length}`);
            
            // Handle length cutoff or connection drop with auto-continuation
            if ((finishReason === 'length' || finishReason === null) && opts.autoContinue && continuations < opts.maxContinuations) {
                continuations++;
                api.v1.log(`[robustGenerateResponse] Cutoff detected (reason: ${finishReason}). Continuation ${continuations}/${opts.maxContinuations}`);
                
                let textToAccumulate = responseText;
                
                if (opts.trimIncomplete) {
                    const lastNewlineIndex = responseText.lastIndexOf('\n');
                    textToAccumulate = lastNewlineIndex > 0 
                        ? responseText.substring(0, lastNewlineIndex + 1)
                        : responseText;
                }
                
                accumulatedText += textToAccumulate;
                
                workingMessages = [...messages];
                workingMessages.push({ role: 'assistant', content: accumulatedText });
                workingMessages.push({ role: 'user', content: opts.continuationPrompt });
                
                continue;
            }
            
            // If we accumulated text from continuations, update the response
            if (accumulatedText) {
                response.choices[0].text = accumulatedText + responseText;
            }
            
            api.v1.log(`[robustGenerateResponse] Complete. Total continuations: ${continuations}, final length: ${response.choices[0].text.length}`);
            return response;
            
        } catch (e) {
            if (e instanceof Error && e.message === GENERATION_LIMIT_ERROR) {
                api.v1.log(`[robustGenerateResponse] Generation limit hit. Showing continue modal.`);
                const shouldContinue = await showContinueModal(progressInfo);
                if (!shouldContinue) {
                    throw new Error("User cancelled generation");
                }
            } else if (isTransientError(e) && attempts < opts.maxRetries) {
                attempts++;
                const errorMsg = e instanceof Error ? e.message : JSON.stringify(e);
                api.v1.log(`[robustGenerateResponse] Transient error (attempt ${attempts}/${opts.maxRetries}): ${errorMsg}. Retrying...`);
                await api.v1.timers.sleep(1000 * attempts);
            } else {
                api.v1.log(`[robustGenerateResponse] Fatal error: ${e instanceof Error ? e.message : JSON.stringify(e)}`);
                throw e;
            }
        }
    }
}
