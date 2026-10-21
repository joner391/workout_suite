/**
 * Workout Suite — Mesocycle Simulation & Profile Progression Tests
 *
 * Verifies that the iterations of mesocycles are sound across diverse lifter profiles
 * and that concise summary bullets ("Increased your volume by 3 weekly sets",
 * "RPE goal increased for accessory exercises", "Optimized meso-cycle length",
 * "Changed exercises based on elbow pain") are deterministically produced.
 */

import {
  runLifterSimulation,
  runAllLifterSimulations,
  CANONICAL_PROFILES,
} from '../mesocycleSimulation';

describe('Mesocycle Simulation & Soundness Assessment', () => {
  // Increase Jest timeout for multi-meso database simulations
  jest.setTimeout(30000);

  it('Profile 1 (Lukas - Overachiever): correctly earns volume and load progression with concise communication', async () => {
    const lukasConfig = CANONICAL_PROFILES.find((p) => p.id === 'lukas_responsive')!;
    expect(lukasConfig).toBeDefined();

    const report = await runLifterSimulation(lukasConfig);

    expect(report.overallSuccess).toBe(true);
    expect(report.steps.length).toBe(2); // Meso 1->2, Meso 2->3

    const meso2Step = report.steps[0];
    expect(meso2Step.toMeso).toBe(2);

    // Verify concise bullet points
    expect(meso2Step.conciseSummaries.some((s) => s.includes('Increased your volume by'))).toBe(true);
    expect(meso2Step.conciseSummaries).toContain('RPE goal increased for accessory exercises');
    expect(meso2Step.conciseSummaries).toContain('Optimized meso-cycle length');

    // Verify markdown header and bullets
    expect(meso2Step.diffMarkdown).toContain('### 🚀 Mesocycle 2 Ready');
    expect(meso2Step.diffMarkdown).toContain('• RPE goal increased for accessory exercises');

    // Verify soundness assertions
    for (const assertion of meso2Step.soundnessAssertions) {
      expect(assertion.passed).toBe(true);
    }
  });

  it('Profile 2 (Erik - Elbow Discomfort): protects elbow joint and holds bench load via Weight Mastery', async () => {
    const erikConfig = CANONICAL_PROFILES.find((p) => p.id === 'erik_elbow_pain')!;
    expect(erikConfig).toBeDefined();

    const report = await runLifterSimulation(erikConfig);

    expect(report.overallSuccess).toBe(true);

    const meso2Step = report.steps[0];
    // Exact user requirement: "Changed exercises based on elbow pain"
    expect(meso2Step.conciseSummaries).toContain('Changed exercises based on elbow pain');
    expect(meso2Step.diffMarkdown).toContain('• Changed exercises based on elbow pain');

    // Verify Skull Crusher was substituted for Cable Tricep Pushdown
    const swapItem = meso2Step.diffItems.find(
      (d) => d.category === 'exercise_swap' && d.explanation.includes('elbow')
    );
    expect(swapItem).toBeDefined();
    expect(swapItem?.explanation).toContain('Cable Tricep Pushdown');

    // Verify Weight Mastery held bench press load
    const holdItem = meso2Step.diffItems.find(
      (d) => d.category === 'load' && d.title.toLowerCase().includes('load held')
    );
    expect(holdItem).toBeDefined();

    // Verify Meso 3: once elbow heals and technique standardizes, weight mastery clears
    const meso3Step = report.steps[1];
    expect(meso3Step.allPassed).toBe(true);
  });

  it('Profile 3 (Sofia - Caloric Deficit): offloads spinal axial fatigue and manages deficit volume', async () => {
    const sofiaConfig = CANONICAL_PROFILES.find((p) => p.id === 'sofia_caloric_deficit')!;
    expect(sofiaConfig).toBeDefined();

    const report = await runLifterSimulation(sofiaConfig);

    expect(report.overallSuccess).toBe(true);

    const meso2Step = report.steps[0];
    // Verify axial offload to Leg Press
    expect(
      meso2Step.conciseSummaries.some((s) =>
        s.toLowerCase().includes('spinal') || s.toLowerCase().includes('axial')
      )
    ).toBe(true);
    expect(meso2Step.conciseSummaries).toContain('Optimized meso-cycle length');
  });

  it('Profile 4 (Marcus - Mentality Shift): stages 3-week transition wave and scales accessory RPE', async () => {
    const marcusConfig = CANONICAL_PROFILES.find((p) => p.id === 'marcus_mentality_shift')!;
    expect(marcusConfig).toBeDefined();

    const report = await runLifterSimulation(marcusConfig);

    expect(report.overallSuccess).toBe(true);

    const meso2Step = report.steps[0];
    expect(
      meso2Step.conciseSummaries.some((s) => s.toLowerCase().includes('transition wave'))
    ).toBe(true);
    expect(meso2Step.conciseSummaries).toContain('RPE goal increased for accessory exercises');
  });

  it('executes runAllLifterSimulations and verifies multi-meso progression is globally sound across all archetypes', async () => {
    const reports = await runAllLifterSimulations();

    expect(reports.length).toBe(4);
    for (const report of reports) {
      expect(report.overallSuccess).toBe(true);
      expect(report.steps.length).toBe(2);
      for (const step of report.steps) {
        expect(step.allPassed).toBe(true);
      }
    }
  });
});
