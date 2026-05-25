export interface Task {
  id: number;
  created_at?: Date;
  updated_at?: Date;
  active: boolean;
  completed: boolean;
  completed_at?: Date;
  todoist_task_id: string;
  linear_task_id: string;
}

export interface Team {
  id: number;
  created_at?: Date;
  updated_at?: Date;
  name: string;
  active: boolean;
  todoist_project_id?: string;
  todoist_label_ids?: string[];
  linear_team_id?: string;
  linear_initial_state_id?: string;
  linear_final_state_id?: string;
}

export interface User {
  id: number;
  created_at?: Date;
  updated_at?: Date;
  email: string;
  name?: string;
  team_id?: number;
  todoist_uid?: string;
  linear_uid?: string;
}
