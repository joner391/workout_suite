/* Read-only domain runner. Run from mobile/; never connects to the app database. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

const mobileRoot = path.resolve(__dirname, '..');
const repoRoot = path.dirname(mobileRoot);
const fixturePath = path.join(__dirname, 'fixtures/program-example-profiles.json');
const args = process.argv.slice(2);
if (args.length > 1 || args[0] === '--help') {
  console.log('Usage (from mobile/): node scripts/generate-program-examples.cjs [output-directory]');
  process.exit(args[0] === '--help' ? 0 : 1);
}
const outputDir = path.resolve(args[0] || path.join(mobileRoot, 'node_modules/.cache/program-examples'));

// Only this short-lived process uses the transpile hook. Typecheck separately.
require.extensions['.ts'] = (module, filename) => {
  if (!filename.startsWith(path.join(mobileRoot, 'src') + path.sep)) {
    throw new Error(`Refusing to transpile outside mobile/src: ${filename}`);
  }
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};
const { synthesizeProgram } = require('../src/core/generator/programSynthesizer.ts');
const { DEFAULT_EXERCISES } = require('../src/database/seeds/defaultExercises.ts');
const catalog = new Map(DEFAULT_EXERCISES.map(exercise => [exercise.id, exercise]));
const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const styles = {
  fury: ['enthusiast', 'high_intensity_low_volume'],
  precision: ['neutral', 'volume_accumulation'],
  get_out: ['minimalist', 'balanced'],
};
const stable = value => JSON.parse(JSON.stringify(value, (key, item) =>
  key === 'created_at' || key === 'updated_at' ? undefined : item));
const examples = fixtures.map(input => {
  const [training_enjoyment, intensity_style] = styles[input.mood];
  const profile = {
    id: `example-user-${input.id}`, gender: input.gender, birthdate: null, height_cm: null,
    primary_goal: input.goal, secondary_goals: input.secondary,
    training_mentality: input.mood, training_enjoyment, intensity_style,
    experience_level: input.experience, preferred_days_per_week: input.days,
    preferred_session_duration_mins: input.minutes, equipment_access: input.equipment,
    created_at: '2026-10-21T00:00:00.000Z', updated_at: '2026-10-21T00:00:00.000Z',
  };
  const result = stable(synthesizeProgram(profile, {
    programId: `example-${input.id}`, experienceLevel: input.experience,
  }));
  return { input, profile: stable(profile), ...result };
});

const relative = filename => path.relative(repoRoot, filename).split(path.sep).join('/');
const sourceFiles = [...new Set([
  __filename, fixturePath,
  ...Object.keys(require.cache).filter(filename => filename.startsWith(path.join(mobileRoot, 'src') + path.sep)),
])].sort();
const sourceHashes = Object.fromEntries(sourceFiles.map(filename => [
  relative(filename), crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),
]));
const git = (...arguments_) => {
  const result = spawnSync('git', arguments_, { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : null;
};
const status = git('status', '--porcelain');
const report = {
  provenance: {
    gitHead: git('rev-parse', 'HEAD'), workingTreeDirty: status === null ? null : status.length > 0,
    node: process.version, typescript: ts.version, sourceHashes,
    note: 'Generated from live source, not hand-edited prescriptions. Timestamps omitted for comparison. Durations and stimulating reps are estimates.',
  },
  examples,
};
const lines = ['# Generated program examples', '', report.provenance.note, '',
  'See docs/PROGRAM_GENERATION_GUIDE.md for review criteria and reproduction.', ''];
const cell = value => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
for (const example of examples) {
  const { input, summary } = example;
  lines.push(`## ${input.title}`, '',
    `${input.experience}; ${input.goal}${input.secondary.length ? ` + ${input.secondary.join(', ')}` : ''}; ${input.days} days × ${input.minutes} minutes; ${input.equipment}.`, '',
    `Resolved split: ${summary.splitType}. Full/activation sets: ${summary.totalWeeklySets}; mini-sets: ${summary.totalWeeklyMiniSets ?? 0}.`, '',
    '| Muscle | Credited full/activation sets | Mini-sets | Estimated stimulating reps |',
    '| --- | ---: | ---: | ---: |');
  const muscles = new Set([...Object.keys(summary.weeklyMuscleSets ?? {}), ...Object.keys(summary.weeklyMiniSets ?? {})]);
  for (const muscle of [...muscles].sort()) {
    lines.push(`| ${muscle} | ${summary.weeklyMuscleSets?.[muscle] ?? 0} | ${summary.weeklyMiniSets?.[muscle] ?? 0} | ${summary.weeklyMuscleEReps?.[muscle] ?? 0} |`);
  }
  lines.push('', 'Planning warnings:', '', ...(summary.planningWarnings?.length
    ? summary.planningWarnings.map(warning => `- ${warning}`) : ['- None from the current planner.']), '');
  example.templates.forEach((template, index) => {
    lines.push(`### ${template.name} — estimated ${summary.sessionDurationsMins?.[index]} min`, '',
      '| Exercise | Full/activation sets | Reps | RPE / RIR | Rest, seconds | Group | Mini-set protocol per activation |',
      '| --- | ---: | --- | --- | ---: | --- | --- |');
    for (const row of example.templateExercises.filter(row => row.template_id === template.id)) {
      const protocol = row.rest_pause;
      lines.push(`| ${[
        catalog.get(row.exercise_id)?.name ?? row.exercise_id, row.target_sets,
        `${row.target_reps_min}–${row.target_reps_max}`, `${row.target_rpe ?? '—'} / ${row.target_rir ?? '—'}`,
        row.rest_seconds, row.exercise_group_id,
        protocol ? `${row.set_type}: ${protocol.mini_sets} × ${protocol.mini_reps_min}–${protocol.mini_reps_max}, ${protocol.rest_seconds}s rest` : 'None',
      ].map(cell).join(' | ')} |`);
    }
    lines.push('');
  });
}
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'program-examples.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(outputDir, 'program-examples.md'), lines.join('\n'));
console.log(`Generated ${examples.length} live examples in ${outputDir}`);
for (const example of examples) {
  console.log(`${example.input.id}: ${example.summary.sessionDurationsMins.join('/')} min; ${example.summary.totalWeeklySets} full/activation + ${example.summary.totalWeeklyMiniSets ?? 0} mini-sets`);
}
