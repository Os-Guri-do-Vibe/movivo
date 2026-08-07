import { Injectable } from '@nestjs/common';

type Handler = (payload: unknown) => Promise<unknown>;

/** Barramento in-process minimo para dominios sem arestas entre modulos. */
@Injectable()
export class DomainEventBus {
  private readonly handlers = new Map<string, Handler>();

  register<TPayload, TResult>(
    event: string,
    handler: (payload: TPayload) => Promise<TResult>,
  ): () => void {
    if (this.handlers.has(event)) throw new Error(`handler ja registrado: ${event}`);
    this.handlers.set(event, handler as Handler);
    return () => this.handlers.delete(event);
  }

  async request<TPayload, TResult>(event: string, payload: TPayload): Promise<TResult | undefined> {
    const handler = this.handlers.get(event);
    return handler ? ((await handler(payload)) as TResult) : undefined;
  }
}
