import {
  addCommentToIssue,
  IssueInfo,
  returnIssueInfo,
} from "./clients/linearClient";
import {
  addTask,
  completeTask,
  deleteTask,
  moveTask,
  updateTask,
} from "./clients/todoistClient";
import { Task } from "./types/database";

const activeStates = ["unstarted", "started"];
const completeStates = ["completed"];
// NOTE: Linear's state.type for cancelled issues is "canceled" (one L, American
// spelling). A previous "cancelled" here never matched, so cancel never deleted.
const backlogStates = ["backlog", "triage", "canceled"];

/**
 * Helper function to create a new Todoist task and database entry for a Linear issue
 */
async function createTaskInTodoistAndDb(
  info: IssueInfo,
  db: any
) {
  const task: any = await addTask({
    content: info.title,
    due_date: info.dueDate,
    priority: info.priority,
    description: `[Linear](${info.url})`,
  });
  const { data, error } = await db
    .from("task")
    .insert({ todoist_task_id: task.id, linear_task_id: info.id, active: true });

  if (error) {
    console.error("error adding task to database", error);
    // Clean up orphaned Todoist task if DB insert fails
    try {
      await deleteTask(task.id);
      console.log("Cleaned up orphaned Todoist task after database failure");
    } catch (cleanupError) {
      console.error("error cleaning up todoist task after database failure", cleanupError);
    }
    throw error;
  }

  await addCommentToIssue(
    info.id,
    "This issue is being tracked in Todoist."
  );

  return data[0];
}

export async function processLinearTask(issue: Request, db: any) {
  console.log("processLinearTask");
    const info: IssueInfo = await returnIssueInfo(issue);
    console.log(info);

    // Check if assignee filtering is enabled
    let assigneeFilter;
    try {
      // @ts-ignore
      assigneeFilter = typeof LINEAR_ASSIGNEE_ID !== 'undefined' ? LINEAR_ASSIGNEE_ID : undefined;
    } catch (e) {
      // LINEAR_ASSIGNEE_ID not defined, filtering disabled
      assigneeFilter = undefined;
    }
    
    console.log(`Assignee filter: ${assigneeFilter}, Issue assignee: ${info.assigneeId}`);

    switch (info.action) {
      case "create":
        // If filter is active and assignee doesn't match, skip syncing
        // This includes cases where assignee is null/undefined (unassigned)
        if (assigneeFilter) {
          if (!info.assigneeId || info.assigneeId !== assigneeFilter) {
            console.log(`Skipping issue ${info.id} - assignee ${info.assigneeId} does not match filter ${assigneeFilter}`);
            return { success: true, message: "Issue filtered by assignee" };
          }
        }
        
        // Only add a task if issue is in progress or queue up. Ignore backlog and completion states.
        if (activeStates.includes(info.state.type)) {
          return await createTaskInTodoistAndDb(info, db);
        }
        break;
      case "update":
        // Check if task is in Todoist
        const { data: task }: { data: Task | null } = await db
          .from("task")
          .select()
          .eq("linear_task_id", info.id)
          .maybeSingle();

        // Handle assignee filtering for updates
        if (assigneeFilter) {
          const assigneeMatches = info.assigneeId === assigneeFilter;
          
          // If assignee matches and task already exists and is active, skip (already synced)
          if (assigneeMatches && task && task.active) {
            console.log(`Task for issue ${info.id} already exists and is active, skipping creation`);
            // Continue to normal update flow below
          }
          // If assignee doesn't match but task exists, delete it (unassigned from filtered user)
          else if (!assigneeMatches && task && task.active) {
            console.log(`Deleting task for issue ${info.id} - unassigned from filtered user`);
            await deleteTask(task.todoist_task_id);
            
            const { data, error } = await db
              .from("task")
              .update({ active: false })
              .match({ linear_task_id: info.id });

            if (error) {
              console.error("error updating task in database", error);
              return error;
            }

            await addCommentToIssue(
              info.id,
              "Issue unassigned. Removed from Todoist."
            );

            return {
              success: true,
              message: "Task removed from Todoist due to assignee change"
            };
          }
          // If assignee now matches but task doesn't exist or is inactive, create it (newly assigned to filtered user)
          else if (assigneeMatches && (!task || !task.active) && activeStates.includes(info.state.type)) {
            console.log(`Creating task for issue ${info.id} - newly assigned to filtered user`);
            const newTask: any = await addTask({
              content: info.title,
              due_date: info.dueDate,
              priority: info.priority,
              description: `[Linear](${info.url})`,
            });
            
            // If task record exists but is inactive, update it
            if (task && !task.active) {
              const { data, error} = await db
                .from("task")
                .update({ todoist_task_id: newTask.id, active: true, completed: false })
                .match({ linear_task_id: info.id });

              if (error) {
                console.error("error updating task in database", error);
                return error;
              }
              
              await addCommentToIssue(
                info.id,
                "This issue is being tracked in Todoist."
              );

              return { success: true, message: "Task created" };
            } else if (!task) {
              // Only insert if no task record exists at all
              const { data, error } = await db
                .from("task")
                .insert({ todoist_task_id: newTask.id, linear_task_id: info.id });

              if (error) {
                // If insert fails due to duplicate, it means create webhook already handled it
                // This is expected when Linear sends both create and update webhooks quickly
                console.log("Task already exists in database, skipping insert");
                return { success: true, message: "Task already tracked" };
              }
              
              await addCommentToIssue(
                info.id,
                "This issue is being tracked in Todoist."
              );

              return { success: true, message: "Task created" };
            }
          }
          // If assignee doesn't match and no task exists, skip
          else if (!assigneeMatches && !task) {
            console.log(`Skipping issue ${info.id} - assignee ${info.assigneeId} does not match filter ${assigneeFilter}`);
            return { success: true, message: "Issue filtered by assignee" };
          }
        }

        // If task completed in Linear
        if (completeStates.includes(info.state.type)) {
          // If not completed, mark completed in Todoist
          if (task && !task.completed) {
            try {
              await completeTask(task.todoist_task_id);
              
              const { data, error } = await db
                .from("task")
                .update({ completed: true, active: false })
                .match({ linear_task_id: info.id });

              if (error) {
                console.error("error updating task in database", error);
                throw error;
              }

              return {
                task: data[0],
                success: true,
                message: "Task completion status synced",
              };
            } catch (err) {
              console.error("error completing task", err);
              throw err;
            }
          }
        } else if (backlogStates.includes(info.state.type)) {
          // If task moved back to backlog, delete from Todoist
          if (task && task.active) {
            try {
              await deleteTask(task.todoist_task_id);
            } catch (err: any) {
              // If task is already deleted (404), that's fine - continue to mark as inactive
              if (!err.message?.includes('404')) {
                console.error("error deleting task from Todoist", err);
                throw err; // Rethrow non-404 errors so webhook can be retried
              }
              console.log("Task already deleted from Todoist (404), marking inactive");
            }

            // Update database to mark task as inactive
            const { data, error } = await db
              .from("task")
              .update({ active: false })
              .match({ linear_task_id: info.id });

            if (error) {
              console.error("error updating task in database", error);
              throw error;
            }

            await addCommentToIssue(
              info.id,
              "Issue moved to backlog. Task deleted from Todoist."
            );

            return {
              task: data[0],
              success: true,
              message: "Task deleted from Todoist",
            };
          }
        } else if (activeStates.includes(info.state.type)) {
          // If task is now in active state
          if (!task) {
            // Task doesn't exist - create it (handles backlog→active transition)
            return await createTaskInTodoistAndDb(info, db);
          } else if (!task.active) {
            // Task exists but is inactive (was deleted from Todoist) - recreate it
            const newTask: any = await addTask({
              content: info.title,
              due_date: info.dueDate,
              priority: info.priority,
              description: `[Linear](${info.url})`,
            });
            const { data, error } = await db
              .from("task")
              .update({ todoist_task_id: newTask.id, active: true })
              .match({ linear_task_id: info.id });

            if (error) {
              console.error("error updating task in database", error);
              // Clean up orphaned Todoist task if DB update fails
              try {
                await deleteTask(newTask.id);
                console.log("Cleaned up orphaned Todoist task after database failure");
              } catch (cleanupError) {
                console.error("error cleaning up todoist task after database failure", cleanupError);
              }
              throw error;
            }

            await addCommentToIssue(
              info.id,
              "This issue is being tracked in Todoist."
            );

            return data[0];
          } else {
            // Task exists and is active - move it if team changed, then update fields
            if (info.previousTeamId) {
              const { data: destTeam } = await db
                .from("team")
                .select()
                .eq("linear_team_id", info.teamId)
                .maybeSingle();
              if (destTeam?.todoist_project_id) {
                await moveTask(task.todoist_task_id, destTeam.todoist_project_id);
              }
            }
            const updated = await updateTask(task.todoist_task_id, {
              content: info.title,
              due_date: info.dueDate || null,
              priority: info.priority,
              description: `[Linear](${info.url})`,
            }).catch((err) => {
              console.log(`Unable to update task in Todoist: ${err}`);
              throw new Error(`Unable to update task in Todoist: ${err}`);
            });

            console.log(updated);
            return updated;
          }
        }
        break;
      case "remove":
        const { data: taskToDelete }: { data: Task | null } = await db
          .from("task")
          .select()
          .eq("linear_task_id", info.id)
          .maybeSingle();
        if (!taskToDelete) return null;

        await deleteTask(taskToDelete.todoist_task_id);
        const { error: deleteRowError } = await db
          .from("task")
          .delete()
          .eq("linear_task_id", info.id);
        if (deleteRowError) throw deleteRowError;

        console.log(`Task deleted: Linear ID ${info.id}, Todoist ID ${taskToDelete.todoist_task_id}`);
        return taskToDelete;
      default:
        return null;
  }
}
