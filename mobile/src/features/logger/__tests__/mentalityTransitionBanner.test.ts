/**
 * Workout Suite — Mentality Transition Banner Test Suite
 *
 * Implements Step 8.4 Verification Gate
 * Validates:
 * - Active transition wave banner rendering
 * - OLED presentation & accessibility labels
 * - Dismiss callback invocation
 * - Null safety when transition is inactive or null
 */

import React from 'react';
import { MentalityTransitionBanner } from '../MentalityTransitionBanner';
import { calculateTransitionWave } from '../../../core/generator/transitionWave';

describe('MentalityTransitionBanner (Step 8.4)', () => {
  it('renders active mentality transition banner with progress and message', () => {
    const wave = calculateTransitionWave('precision', 'fury', 1, 3);
    const onDismiss = jest.fn();

    const element = MentalityTransitionBanner({
      transitionWave: wave,
      onDismiss,
    }) as React.ReactElement<any>;

    expect(element).not.toBeNull();
    expect(React.isValidElement(element)).toBe(true);
    expect(element.props.testID).toBe('mentality-transition-banner');
    expect(element.props.accessibilityLabel).toContain('Mentality Transition: Week 1 of 3 (Precision → Fury)');

    // Verify contentRow children
    const contentRow = element.props.children;
    expect(contentRow).toBeDefined();

    // Verify dismiss button presence and callback trigger
    const dismissButton = contentRow.props.children[2];
    expect(dismissButton).toBeDefined();
    expect(dismissButton.props.testID).toBe('mentality-transition-dismiss-button');
    dismissButton.props.onPress();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('returns null when transitionWave is null or undefined', () => {
    const element = MentalityTransitionBanner({
      transitionWave: null,
    });
    expect(element).toBeNull();

    const elementUndefined = MentalityTransitionBanner({
      transitionWave: undefined,
    });
    expect(elementUndefined).toBeNull();
  });

  it('returns null when transitionWave is inactive (e.g. past total weeks)', () => {
    const wave = calculateTransitionWave('precision', 'fury', 4, 3);
    const element = MentalityTransitionBanner({
      transitionWave: wave,
    });
    expect(element).toBeNull();
  });

  it('renders reverse wave (fury -> precision) with added sets and easing RPE', () => {
    const wave = calculateTransitionWave('fury', 'precision', 1, 3);
    const element = MentalityTransitionBanner({
      transitionWave: wave,
    }) as React.ReactElement<any>;

    expect(element).not.toBeNull();
    expect(React.isValidElement(element)).toBe(true);
    expect(element.props.accessibilityLabel).toContain('Mentality Transition: Week 1 of 3 (Fury → Precision)');
    expect(element.props.accessibilityLabel).toContain('RPE easing (-0.5)');
    expect(element.props.accessibilityLabel).toContain('1 set is added');
  });
});
