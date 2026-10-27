import { Module } from '@nestjs/common';

import { ExerciseCatalogProvider } from './exercises/exercise-catalog-provider.service';

/** Catálogos que os agentes e os validadores usam. */
@Module({
  providers: [ExerciseCatalogProvider],
  exports: [ExerciseCatalogProvider],
})
export class CatalogModule {}
