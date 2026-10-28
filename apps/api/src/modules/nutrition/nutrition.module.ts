import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { ExecutionTasksModule } from '../execution-tasks/execution-tasks.module';
import { TrainingModule } from '../training/training.module';
import { FoodLogService } from './food-log.service';
import { NutritionController } from './nutrition.controller';

/** Registro alimentar do aluno: texto/foto → rascunho → confirmação, e o dia com a meta. */
@Module({
  imports: [CatalogModule, DomainEventsModule, ExecutionTasksModule, TrainingModule],
  controllers: [NutritionController],
  providers: [FoodLogService],
  exports: [FoodLogService],
})
export class NutritionModule {}
