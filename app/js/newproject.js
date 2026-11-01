// A cancelled or failed save must leave the current project open.
export async function startNewProject({ saveFirst, save, isDirty, start }) {
  if (saveFirst) {
    await save();
    if (isDirty()) return false;
  }
  start();
  return true;
}
