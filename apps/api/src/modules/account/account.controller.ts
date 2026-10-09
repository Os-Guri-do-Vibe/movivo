/**
 * Contratos REST da própria conta interna do dashboard (tela "Minha Conta").
 *
 *  - `GET   /account/profile`      — nome, e-mail, telefone, avatar e papel.
 *  - `PATCH /account/profile`      — nome e/ou telefone (e-mail é imutável).
 *  - `POST  /account/password`     — troca de senha, exige a senha atual.
 *  - `POST  /account/avatar`       — upload de foto de perfil (JPEG/PNG/WebP).
 *  - `GET   /account/avatar/:file` — leitura autenticada da foto.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { changePasswordSchema, updateAccountProfileSchema } from '@movivo/shared';
import type { Request, Response } from 'express';
// Import só de tipo, por efeito colateral: traz a augmentation global
// `Express.Multer.File` de `@types/multer` — o tsconfig restringe `types` a
// `["node"]` (§ raiz), então sem esta linha o compilador não vê o namespace.
import 'multer';

import { accessMetaFrom } from '../auth/auth-audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { parseBody } from '../../core/validation/strict-input';
import { AccountService } from './account.service';
import { AVATAR_UPLOAD_HARD_CEILING_BYTES, AvatarStorageService } from './avatar-storage.service';

@ApiTags('Conta')
@Controller('account')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly avatarStorage: AvatarStorageService,
  ) {}

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Perfil da própria conta',
    description: 'Nome, e-mail (imutável), telefone, URL do avatar e papel da conta autenticada.',
  })
  @ApiResponse({ status: 200, description: 'Perfil da conta.' })
  @ApiResponse({ status: 401, description: 'Access token ausente ou inválido.' })
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.account.getProfile(user.userId, user.role);
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Atualiza nome e/ou telefone',
    description:
      'E-mail é imutável (decisão do fundador). Ao menos um dos dois campos deve ser enviado.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(updateAccountProfileSchema) })
  @ApiResponse({ status: 200, description: 'Perfil atualizado.' })
  @ApiResponse({
    status: 400,
    description: 'Nenhum campo enviado, ou telefone fora do formato E.164.',
  })
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const input = parseBody(updateAccountProfileSchema, body);
    return this.account.updateProfile(user.userId, user.role, input);
  }

  @Post('password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Troca a própria senha',
    description:
      'Exige a senha atual (defesa contra sequestro de sessão). Nova senha com mínimo de 12 caracteres.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(changePasswordSchema) })
  @ApiResponse({ status: 204, description: 'Senha alterada — sem corpo de resposta.' })
  @ApiResponse({ status: 400, description: 'Nova senha abaixo do piso de 12 caracteres.' })
  @ApiResponse({ status: 401, description: 'Senha atual incorreta.' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const input = parseBody(changePasswordSchema, body);
    await this.account.changePassword(user.userId, user.role, input, accessMetaFrom(req));
  }

  @Post('avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('avatar', { limits: { fileSize: AVATAR_UPLOAD_HARD_CEILING_BYTES } }),
  )
  @ApiBearerAuth('access-token')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload da foto de perfil',
    description:
      'Aceita JPEG, PNG ou WebP, respeitando o tamanho máximo configurado (`AVATAR_UPLOAD_MAX_BYTES`).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { avatar: { type: 'string', format: 'binary' } },
      required: ['avatar'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Avatar atualizado — retorna a URL pública do novo arquivo.',
  })
  @ApiResponse({
    status: 400,
    description: 'Arquivo ausente, formato não suportado ou acima do tamanho máximo.',
  })
  async uploadAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('Envie um arquivo de imagem.');
    if (!this.avatarStorage.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Formato de imagem não suportado (use JPEG, PNG ou WebP).');
    }
    if (!/\.(jpe?g|png|webp)$/i.test(file.originalname ?? '')) {
      throw new BadRequestException('Extensão de imagem não suportada (use JPG, PNG ou WebP).');
    }
    if (file.size > this.avatarStorage.maxUploadBytes) {
      throw new BadRequestException('Arquivo excede o tamanho máximo permitido.');
    }
    return this.account.updateAvatar(user.userId, user.role, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
    });
  }

  @Get('avatar/:filename')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Serve a imagem do avatar para o dashboard autenticado',
  })
  @ApiParam({
    name: 'filename',
    description: 'Nome do arquivo salvo (UUID + extensão), retornado em `avatarUrl`.',
  })
  @ApiResponse({
    status: 200,
    description: 'Bytes da imagem, com cache privado.',
  })
  @ApiResponse({ status: 404, description: 'Arquivo inexistente.' })
  async serveAvatar(@Param('filename') filename: string, @Res() res: Response): Promise<void> {
    const file = await this.avatarStorage.read(filename);
    if (!file) {
      res.status(HttpStatus.NOT_FOUND).end();
      return;
    }
    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(file.buffer);
  }
}
