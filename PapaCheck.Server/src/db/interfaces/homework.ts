import type { HomeworkDTO, FreeTimeTaskDTO } from '../dto.js';

export interface IHomeworkStore {
  getHomeworks(dateKey: string, tenantId?: string, childId?: string): Promise<HomeworkDTO[]>;
  saveHomeworks(dateKey: string, items: HomeworkDTO[], tenantId?: string, childId?: string): Promise<void>;
  moveHomework(fromDate: string, toDate: string, hwId: string, tenantId?: string, childId?: string): Promise<HomeworkDTO | null>;
  getHomeworkById(id: string, tenantId?: string, childId?: string): Promise<HomeworkDTO | null>;
  putHomework(id: string, data: HomeworkDTO, tenantId?: string, childId?: string): Promise<void>;
  patchHomework(id: string, fields: Partial<HomeworkDTO>, tenantId?: string, childId?: string): Promise<void>;
  deleteHomework(id: string, tenantId?: string, childId?: string): Promise<void>;
  getFreeTime(dateKey: string, tenantId?: string, childId?: string): Promise<FreeTimeTaskDTO[]>;
  saveFreeTime(dateKey: string, tasks: FreeTimeTaskDTO[], tenantId?: string, childId?: string): Promise<void>;
  putFreeTimeTask(id: string, data: FreeTimeTaskDTO, tenantId?: string, childId?: string): Promise<void>;
}
