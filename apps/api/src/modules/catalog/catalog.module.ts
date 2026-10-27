import { Module } from '@nestjs/common';

import { ExerciseCatalogProvider } from './exercises/exercise-catalog-provider.service';
import { FoodCatalogService } from './foods/food-catalog.service';

/**
 * Catálogos que os agentes e os validadores usam: exercícios de força (com equivalências e
 * contraindicações), estações de HYROX e a base de alimentos (TACO).
 */
@Module({
  providers: [ExerciseCatalogProvider, FoodCatalogService],
  exports: [ExerciseCatalogProvider, FoodCatalogService],
})
export class CatalogModule {}
