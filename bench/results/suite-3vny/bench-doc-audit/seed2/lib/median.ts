export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  nums = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}
