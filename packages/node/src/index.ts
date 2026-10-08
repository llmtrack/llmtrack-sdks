import type {
  AuthErrorResponse,
  DuplicateResponse,
  IngestLlmRequest200Response,
  IngestRequest,
  IngestSuccess,
  InternalErrorResponse,
  InvalidPayloadResponse,
  PaymentRequiredResponse,
} from './generated/models/index.js';

export type {
  AuthErrorResponse,
  DuplicateResponse,
  IngestLlmRequest200Response,
  IngestRequest,
  IngestSuccess,
  InternalErrorResponse,
  InvalidPayloadResponse,
  PaymentRequiredResponse,
  SourceTriple,
  VisibilityContext,
} from './generated/models/index.js';

export type TrackResult = IngestLlmRequest200Response;
export type ErrorCode = 'INVALID_API_KEY'|'REVOKED_API_KEY'|'INACTIVE_API_KEY'|'INVALID_PAYLOAD'|'QUOTA_EXCEEDED'|'PLAN_INACTIVE'|'NETWORK_ERROR';
type ErrorResponse = InvalidPayloadResponse | AuthErrorResponse | PaymentRequiredResponse | InternalErrorResponse;
export interface LLMtrackErrorShape { code: ErrorCode; message: string; status?: number; responseBody?: ErrorResponse | unknown; payload: Omit<IngestRequest, 'metadata'> }
export class LLMtrackError extends Error implements LLMtrackErrorShape {
  constructor(public code: ErrorCode, message: string, public payload: Omit<IngestRequest,'metadata'>, public status?: number, public responseBody?: ErrorResponse | unknown) { super(message); this.name='LLMtrackError'; }
}
export interface LLMtrackWarning { code: 'UNKNOWN_MODEL'; message: string }
export interface TrackOptions {
  provider: string; model: string; promptTokens?: number | null; completionTokens?: number | null; totalTokens?: number | null;
  reasoningTokens?: number | null; cachedInputTokens?: number | null; cacheWriteTokens?: number | null;
  inputAudioTokens?: number | null; outputAudioTokens?: number | null;
  cacheAccounting?: 'inclusive' | 'exclusive';
  feature?: string; customerId?: string; customerName?: string; metadata?: Record<string, unknown>;
  latencyMs?: number | null; status?: 'success'|'error'|'timeout'|'cancelled'; environment?: string; idempotencyKey?: string;
}
export interface LLMtrackOptions {
  apiKey: string; baseUrl?: string; environment?: string; onError?: (error: LLMtrackError)=>void;
  onWarning?: (warning: LLMtrackWarning)=>void; enabled?: boolean; timeoutMs?: number; maxRetries?: number;
}
const warned = new Set<string>();
export class LLMtrack {
  private readonly baseUrl; private readonly environment; private readonly onError; private readonly onWarning;
  private readonly enabled; private readonly timeoutMs; private readonly maxRetries;
  constructor(private readonly options: LLMtrackOptions) {
    if (!options.apiKey) throw new TypeError('apiKey is required');
    this.baseUrl=(options.baseUrl ?? 'https://llm-track.com').replace(/\/$/,''); this.environment=options.environment ?? 'production';
    this.onError=options.onError ?? ((e)=>console.warn(`[llmtrack] ${e.code}: ${e.message}`));
    this.onWarning=options.onWarning ?? ((w)=>console.warn(`[llmtrack] ${w.code}: ${w.message}`));
    this.enabled=options.enabled ?? true; this.timeoutMs=options.timeoutMs ?? 5000; this.maxRetries=options.maxRetries ?? 3;
  }
  track(input: TrackOptions): void {
    if (!this.enabled) return;
    void this.deliver(input).catch((e: unknown)=>{ try { this.onError(this.normalizeUnexpected(e, input)); } catch { /* user callbacks cannot escape fire-and-forget */ } });
  }
  async trackSync(input: TrackOptions): Promise<TrackResult | undefined> {
    if (!this.enabled) return undefined;
    return this.deliver(input);
  }
  private payload(input: TrackOptions): IngestRequest {
    const payload: IngestRequest = {provider:input.provider, model:input.model, promptTokens:input.promptTokens, completionTokens:input.completionTokens,
      totalTokens:input.totalTokens, reasoningTokens:input.reasoningTokens, cachedInputTokens:input.cachedInputTokens, cacheWriteTokens:input.cacheWriteTokens,
      inputAudioTokens:input.inputAudioTokens, outputAudioTokens:input.outputAudioTokens,
      cacheAccounting:input.cacheAccounting,
      feature:input.feature, customerId:input.customerId, customerName:input.customerName,
      metadata:input.metadata, latencyMs:input.latencyMs, status:input.status, environment:input.environment ?? this.environment};
    const clean=Object.fromEntries(Object.entries(payload).filter(([,v])=>v!==undefined)) as unknown as IngestRequest;
    const safe=Object.fromEntries(Object.entries(clean).filter(([k])=>k!=='metadata')) as Omit<IngestRequest,'metadata'>;
    if (!input.provider?.trim()) throw new LLMtrackError('INVALID_PAYLOAD','provider must be a non-empty string.',safe);
    if (!input.model?.trim()) throw new LLMtrackError('INVALID_PAYLOAD','model must be a non-empty string.',safe);
    for (const [name,value] of [['promptTokens',input.promptTokens],['completionTokens',input.completionTokens],['totalTokens',input.totalTokens],['reasoningTokens',input.reasoningTokens],['cachedInputTokens',input.cachedInputTokens],['cacheWriteTokens',input.cacheWriteTokens],['inputAudioTokens',input.inputAudioTokens],['outputAudioTokens',input.outputAudioTokens],['latencyMs',input.latencyMs]] as const)
      if (value != null && (!Number.isInteger(value) || value < 0)) throw new LLMtrackError('INVALID_PAYLOAD',`${name} must be a non-negative integer.`,safe);
    if (input.cacheAccounting !== undefined && input.cacheAccounting !== 'inclusive' && input.cacheAccounting !== 'exclusive')
      throw new LLMtrackError('INVALID_PAYLOAD','cacheAccounting must be "inclusive" or "exclusive".',safe);
    if (input.metadata !== undefined && new TextEncoder().encode(JSON.stringify(input.metadata)).length > 8192)
      throw new LLMtrackError('INVALID_PAYLOAD','metadata must serialize to at most 8192 bytes.',safe);
    return clean;
  }
  private async deliver(input: TrackOptions): Promise<TrackResult> {
    let payload: IngestRequest;
    try { payload=this.payload(input); } catch(e) { throw this.normalizeUnexpected(e,input); }
    const key=input.idempotencyKey ?? crypto.randomUUID(); let last: unknown;
    for(let attempt=0;attempt<this.maxRetries;attempt++) {
      try {
        const response=await fetch(`${this.baseUrl}/api/ingest`,{method:'POST',headers:{'content-type':'application/json','X-API-Key':this.options.apiKey,'Idempotency-Key':key},body:JSON.stringify(this.wirePayload(payload)),signal:AbortSignal.timeout(this.timeoutMs)});
        const text=await response.text(); let body: any; try { body=text ? JSON.parse(text):{}; } catch { body=text; }
        if (!response.ok) { const error=this.httpError(response.status,body,payload); if(response.status<500) throw error; last=error; }
        else { const result=this.result(body);this.warnings(result,payload);return result; }
      } catch(e) { if(e instanceof LLMtrackError && e.status && e.status<500) throw e; last=e; }
      if(attempt+1<this.maxRetries) await new Promise(r=>setTimeout(r,Math.random()*100*2**attempt));
    }
    if(last instanceof LLMtrackError && last.status) throw last;
    throw new LLMtrackError('NETWORK_ERROR','Request failed after retries; check network connectivity and the LLMtrack URL.',this.withoutMetadata(payload),undefined,last);
  }
  private wirePayload(p: IngestRequest): Record<string, unknown> {
    const names: Record<string,string>={promptTokens:'prompt_tokens',completionTokens:'completion_tokens',totalTokens:'total_tokens',reasoningTokens:'reasoning_tokens',cachedInputTokens:'cached_input_tokens',cacheWriteTokens:'cache_write_tokens',inputAudioTokens:'input_audio_tokens',outputAudioTokens:'output_audio_tokens',cacheAccounting:'cache_accounting',latencyMs:'latency_ms',customerId:'customer_id',customerName:'customer_name'};
    return Object.fromEntries(Object.entries(p).map(([key,value])=>[names[key]??key,value]));
  }
  private result(body:any):TrackResult {
    if(body?.duplicate===true)return body as DuplicateResponse;
    return {...body,consumptionSource:body?.consumption_source,pricingStatus:body?.pricing_status} as IngestSuccess;
  }
  private withoutMetadata(p: IngestRequest) { const {metadata:_,...safe}=p; return safe; }
  private httpError(status:number, body:any, payload:IngestRequest): LLMtrackError {
    let code:ErrorCode='NETWORK_ERROR', message=`LLMtrack returned HTTP ${status}.`;
    if(status===400){code='INVALID_PAYLOAD';message=`Invalid payload${body?.field ? ` field '${body.field}'`:''}: ${body?.message ?? 'check the submitted value'}.`;}
    if(status===401){code=body?.error==='Revoked API key'?'REVOKED_API_KEY':body?.error==='Inactive API key'?'INACTIVE_API_KEY':'INVALID_API_KEY';message=`Authentication failed: ${body?.error ?? 'Invalid API key'}. Check LLMTRACK_API_KEY.`;}
    if(status===402){code=body?.code==='PAID_PLAN_INACTIVE'?'PLAN_INACTIVE':'QUOTA_EXCEEDED';const quota=body?.quota;message=quota?`Plan '${quota.plan}' cannot accept this event (limit: ${quota.limit}). Check billing or plan limits.`:`${body?.error ?? 'Usage limit reached'}. Check billing or plan limits.`;}
    return new LLMtrackError(code,message,this.withoutMetadata(payload),status,body);
  }
  private warnings(body:TrackResult,payload:IngestRequest) {
    if(body?.duplicate===true)return;
    const success=body as IngestSuccess;
    if(success.pricingStatus==='unknown_model')this.warnOnce(`pricing:${payload.provider}/${payload.model}`,'UNKNOWN_MODEL',`No pricing configured for ${payload.provider}/${payload.model}; cost recorded as 0.`);
  }
  private warnOnce(key:string,code:LLMtrackWarning['code'],message:string){if(!warned.has(key)){warned.add(key);this.onWarning({code,message});}}
  private normalizeUnexpected(e:unknown,input:TrackOptions):LLMtrackError {if(e instanceof LLMtrackError)return e;const {metadata:_,...safe}=input;return new LLMtrackError('NETWORK_ERROR',e instanceof Error?e.message:String(e),safe as unknown as Omit<IngestRequest,'metadata'>);}
}

export { LLMtrack as LLMTrack };

function supplied(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined;
}

export function fromOpenAIUsage(usage: unknown): Partial<Pick<TrackOptions, 'promptTokens'|'completionTokens'|'totalTokens'|'reasoningTokens'|'cachedInputTokens'|'inputAudioTokens'|'outputAudioTokens'|'cacheAccounting'>> {
  if (usage == null || typeof usage !== 'object') return {};
  const source = usage as Record<string, unknown>;
  const chat = 'prompt_tokens' in source || 'completion_tokens' in source || 'prompt_tokens_details' in source || 'completion_tokens_details' in source;
  const result: Record<string, unknown> = {cacheAccounting:'inclusive'};
  const copy = (target: string, key: string) => { if (supplied(source,key)) result[target]=source[key]; };
  copy('promptTokens',chat?'prompt_tokens':'input_tokens');
  copy('completionTokens',chat?'completion_tokens':'output_tokens');
  copy('totalTokens','total_tokens');
  const reasoning = source[chat?'completion_tokens_details':'output_tokens_details'];
  if (reasoning != null && typeof reasoning === 'object' && supplied(reasoning as Record<string, unknown>,'reasoning_tokens')) result.reasoningTokens=(reasoning as Record<string, unknown>).reasoning_tokens;
  if (reasoning != null && typeof reasoning === 'object' && supplied(reasoning as Record<string, unknown>,'audio_tokens')) result.outputAudioTokens=(reasoning as Record<string, unknown>).audio_tokens;
  const cached = source[chat?'prompt_tokens_details':'input_tokens_details'];
  if (cached != null && typeof cached === 'object' && supplied(cached as Record<string, unknown>,'cached_tokens')) result.cachedInputTokens=(cached as Record<string, unknown>).cached_tokens;
  if (cached != null && typeof cached === 'object' && supplied(cached as Record<string, unknown>,'audio_tokens')) result.inputAudioTokens=(cached as Record<string, unknown>).audio_tokens;
  return result as Partial<Pick<TrackOptions, 'promptTokens'|'completionTokens'|'totalTokens'|'reasoningTokens'|'cachedInputTokens'|'inputAudioTokens'|'outputAudioTokens'|'cacheAccounting'>>;
}

export function fromAnthropicUsage(usage: unknown): Partial<Pick<TrackOptions, 'promptTokens'|'completionTokens'|'cachedInputTokens'|'cacheWriteTokens'|'cacheAccounting'>> {
  if (usage == null || typeof usage !== 'object') return {};
  const source = usage as Record<string, unknown>;
  const result: Record<string, unknown> = {cacheAccounting:'exclusive'};
  for (const [target,key] of [['promptTokens','input_tokens'],['completionTokens','output_tokens'],['cachedInputTokens','cache_read_input_tokens'],['cacheWriteTokens','cache_creation_input_tokens']] as const)
    if (supplied(source,key)) result[target]=source[key];
  return result as Partial<Pick<TrackOptions, 'promptTokens'|'completionTokens'|'cachedInputTokens'|'cacheWriteTokens'|'cacheAccounting'>>;
}
