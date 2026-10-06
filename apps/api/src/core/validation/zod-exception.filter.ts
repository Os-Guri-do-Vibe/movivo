import { ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/** Rejeita entrada inválida sem serializar valores, nomes de campos ou dados de saúde. */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(_error: ZodError, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(400).json({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Dados de entrada inválidos.',
    });
  }
}
