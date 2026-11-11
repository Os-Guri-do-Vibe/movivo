import { Module } from '@nestjs/common';

import { AppConfigService } from '../config';
import type { ModelVendorClient } from './ai.types';
import { MODEL_VENDOR_CLIENTS, ModelGateway, ModelRunRecorder } from './model-gateway';
import { ModelTierConfig } from './model-tier-config';
import { AnthropicVendor, DeepSeekVendor, OpenAiVendor } from './vendors';

/**
 * Gateway de modelos por capacidade. As chaves e os atestados de diligência para dado de saúde
 * vêm da mesma configuração do roteador legado (ADR-005-R2).
 */
@Module({
  providers: [
    {
      provide: MODEL_VENDOR_CLIENTS,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): ModelVendorClient[] => {
        const llm = config.llm;
        return [
          new DeepSeekVendor(llm.deepseekApiKey, llm.deepseekHealthDataApproved),
          new OpenAiVendor(llm.openaiApiKey, llm.openaiHealthDataApproved),
          new AnthropicVendor(llm.anthropicApiKey, llm.anthropicHealthDataApproved),
        ];
      },
    },
    ModelTierConfig,
    ModelRunRecorder,
    ModelGateway,
  ],
  exports: [ModelGateway, ModelTierConfig],
})
export class AiModule {}
