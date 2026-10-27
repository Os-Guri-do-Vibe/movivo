import { Module } from '@nestjs/common';

import { StudentStateReader } from './student-state.reader';

/** Estado do Aluno: leitura em fatias para os agentes (escritas vêm dos módulos de domínio). */
@Module({
  providers: [StudentStateReader],
  exports: [StudentStateReader],
})
export class StudentStateModule {}
