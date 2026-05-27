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
const backlogStates = ["backlog", "triage", "cancelled"];

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
    .insert({ todoist_task_id: task.id, linear_task_id: info.id });

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

    switch (info.action) {
      case "create":
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
        // Check if task exists in Todoist
        const { data: taskToDelete }: { data: Task | null } = await db
          .from("task")
          .select()
          .eq("linear_task_id", info.id)
          .maybeSingle();

        if (taskToDelete) {
          try {
            await deleteTask(taskToDelete.todoist_task_id);

            // Remove from database
            const { error } = await db
              .from("task")
              .delete()
              .eq("linear_task_id", info.id);

            if (error) {
              throw new Error(`Failed to delete task from database: ${error.message || error}`);
            }

            const deleted = {
              task: taskToDelete,
              success: true,
              message: "Task deleted from Todoist and database",
            };
            console.log(`Task deleted successfully: Linear ID ${info.id}, Todoist ID ${taskToDelete.todoist_task_id}`);
            return deleted;
          } catch (err) {
            console.error(`Error deleting task (Linear ID ${info.id}):`, err);
            const deleted = {
              success: false,
              message: `Unable to delete task: ${err instanceof Error ? err.message : err}`,
            };
            return deleted;
          }
        } else {
          return {
            success: false,
            message: "Task not found in database, nothing to delete",
          };
        }
        break;
      default:
        return null;
  }
}
