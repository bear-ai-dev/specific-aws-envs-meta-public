export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const lastDayOfMonth = () => {
  const currentDate = new Date();
  const lastDayOfMonth = new Date(
    Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, 0, 0, 0, 0, 0)
  );
  return lastDayOfMonth;
}