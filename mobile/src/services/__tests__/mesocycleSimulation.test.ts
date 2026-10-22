import { CANONICAL_PROFILES, runLifterSimulation, runAllLifterSimulations } from '../mesocycleSimulation';

describe('Response-led integration scenarios', () => {
  test.each(CANONICAL_PROFILES)('$name: $description', async config => {
    const report = await runLifterSimulation(config);
    expect(report.overallSuccess).toBe(true);
    expect(report.steps.map(step => step.toMeso)).toEqual([2, 3]);
    expect(report.steps.every(step => step.soundnessAssertions.every(a => a.passed))).toBe(true);
    if (config.scenario === 'progressing' || config.scenario === 'deficit') {
      expect(report.steps[0].conciseSummaries).toContain('Productive prescription retained');
      expect(report.steps[0].diffItems.some(item => item.category === 'exercise_swap')).toBe(false);
    }
    if (config.scenario === 'mood') expect(report.steps[0].diffItems.some(item => item.title.includes('training preference updated'))).toBe(true);
  });
  test('all profiles run without relying on unsupported volume or timing claims', async () => {
    expect((await runAllLifterSimulations()).every(report => report.overallSuccess)).toBe(true);
  });
});
