'use client';

import { createContext, useContext, type ReactNode } from 'react';

import * as evolution from '@/lib/checkin-api';
import * as nutrition from '@/lib/nutrition-api';
import * as live from '@/lib/training-api';

/**
 * O que as páginas do aluno (treino, alimentação e evolução) usam para falar com a API. Em
 * produção é sempre o cliente real; a página de demonstração local troca por uma simulação em
 * memória, para mostrar todos os cenários sem tocar em dado de aluno.
 */
export interface TrainingApi {
  getTrainingDay: typeof live.getTrainingDay;
  startSession: typeof live.startSession;
  saveSets: typeof live.saveSets;
  saveMetrics: typeof live.saveMetrics;
  uploadActivityFile: typeof live.uploadActivityFile;
  uploadScreenshot: typeof live.uploadScreenshot;
  finishExecution: typeof live.finishExecution;
  logExternal: typeof live.logExternal;
  saveCheckIn: typeof live.saveCheckIn;
  getShareCard: typeof live.getShareCard;
  getShareCardImage: typeof live.getShareCardImage;
  getFoodDay: typeof nutrition.getFoodDay;
  draftFromText: typeof nutrition.draftFromText;
  draftFromPhoto: typeof nutrition.draftFromPhoto;
  confirmFoodLog: typeof nutrition.confirmFoodLog;
  removeFoodLog: typeof nutrition.removeFoodLog;
  updateFoodLog: typeof nutrition.updateFoodLog;
  getEvolution: typeof evolution.getEvolution;
  addMeasurements: typeof evolution.addMeasurements;
}

// Chamadas preguiçosas ao módulo: os testes que fazem `vi.mock` do cliente continuam valendo.
export const liveTrainingApi: TrainingApi = {
  getTrainingDay: (...args) => live.getTrainingDay(...args),
  startSession: (...args) => live.startSession(...args),
  saveSets: (...args) => live.saveSets(...args),
  saveMetrics: (...args) => live.saveMetrics(...args),
  uploadActivityFile: (...args) => live.uploadActivityFile(...args),
  uploadScreenshot: (...args) => live.uploadScreenshot(...args),
  finishExecution: (...args) => live.finishExecution(...args),
  logExternal: (...args) => live.logExternal(...args),
  saveCheckIn: (...args) => live.saveCheckIn(...args),
  getShareCard: (...args) => live.getShareCard(...args),
  getShareCardImage: (...args) => live.getShareCardImage(...args),
  getFoodDay: (...args) => nutrition.getFoodDay(...args),
  draftFromText: (...args) => nutrition.draftFromText(...args),
  draftFromPhoto: (...args) => nutrition.draftFromPhoto(...args),
  confirmFoodLog: (...args) => nutrition.confirmFoodLog(...args),
  removeFoodLog: (...args) => nutrition.removeFoodLog(...args),
  updateFoodLog: (...args) => nutrition.updateFoodLog(...args),
  getEvolution: (...args) => evolution.getEvolution(...args),
  addMeasurements: (...args) => evolution.addMeasurements(...args),
};

const TrainingApiContext = createContext<TrainingApi>(liveTrainingApi);

export function TrainingApiProvider({ api, children }: { api: TrainingApi; children: ReactNode }) {
  return <TrainingApiContext.Provider value={api}>{children}</TrainingApiContext.Provider>;
}

export function useTrainingApi(): TrainingApi {
  return useContext(TrainingApiContext);
}
