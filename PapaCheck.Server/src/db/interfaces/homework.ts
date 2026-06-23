export interface IHomeworkStore {
  getHomeworks(dateKey: string, tenantId?: string, childId?: string): Promise<any[]>;
  saveHomeworks(dateKey: string, items: any[], tenantId?: string, childId?: string): Promise<void>;
  moveHomework(fromDate: string, toDate: string, hwId: string, tenantId?: string, childId?: string): Promise<any | null>;
  getHomeworkById(id: string, tenantId?: string, childId?: string): Promise<any | null>;
  putHomework(id: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  patchHomework(id: string, fields: any, tenantId?: string, childId?: string): Promise<void>;
  deleteHomework(id: string, tenantId?: string, childId?: string): Promise<void>;
  getFreeTime(dateKey: string, tenantId?: string, childId?: string): Promise<any[]>;
  saveFreeTime(dateKey: string, tasks: any[], tenantId?: string, childId?: string): Promise<void>;
  putFreeTimeTask(id: string, data: any, tenantId?: string, childId?: string): Promise<void>;
}
