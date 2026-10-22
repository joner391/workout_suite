import React from 'react';
import { BottomTabBar } from '../BottomTabBar';
import { AppIcon, IconButton } from '../AppIcon';
import { ScreenHeader } from '../ScreenHeader';

function find(tree: React.ReactNode, predicate: (element: React.ReactElement<any>) => boolean): React.ReactElement<any>[] {
  if (!React.isValidElement<any>(tree)) return [];
  const node = tree as React.ReactElement<{ children?: React.ReactNode }>;
  return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props.children).flatMap(child => find(child, predicate))];
}

test('each tab routes to its own destination and exposes the selected state', () => {
  const onSelect = jest.fn();
  const tree = BottomTabBar({ currentTab: 'profile', hasActiveWorkout: false, onSelect });
  const tabs = find(tree, node => node.props.accessibilityRole === 'tab');
  expect(tabs).toHaveLength(4);
  for (const tab of tabs) {
    tab.props.onPress();
    expect(onSelect).toHaveBeenLastCalledWith(tab.props.testID.replace('tab-btn-', ''));
    expect(tab.props.accessibilityState.selected).toBe(tab.props.testID === 'tab-btn-profile');
  }
});

test('the workout indicator remains visible and accessible while another tab is selected', () => {
  const tree = BottomTabBar({ currentTab: 'home', hasActiveWorkout: true, onSelect: jest.fn() });
  expect(find(tree, node => node.props.testID === 'active-workout-tab-dot')).toHaveLength(1);
  const workout = find(tree, node => node.props.testID === 'tab-btn-workout')[0];
  expect(workout.props.accessibilityLabel).toContain('workout in progress');
  expect(workout.props.accessibilityState.selected).toBe(false);
  const inactive = BottomTabBar({ currentTab: 'home', hasActiveWorkout: false, onSelect: jest.fn() });
  expect(find(inactive, node => node.props.testID === 'active-workout-tab-dot')).toHaveLength(0);
});

test('navigation icons accept the requested tint on a shared vector grid', () => {
  for (const name of ['home', 'workout', 'profile', 'settings'] as const) {
    const icon = AppIcon({ name, color: '#86EFAC' });
    expect(icon.props).toMatchObject({ viewBox: '0 0 24 24', width: 24, height: 24, stroke: '#86EFAC' });
  }
});

test('a long screen title keeps its close action and supplied secondary actions', () => {
  const onClose = jest.fn();
  const action = React.createElement('Action', { label: 'Add equipment' });
  const tree = ScreenHeader({ title: 'A very long equipment inventory and configuration title', onClose, closeTestID: 'close-screen', actions: action });
  const close = find(tree, node => node.props.testID === 'close-screen')[0];
  const button = IconButton(close.props);
  button.props.onPress();
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(button.props.accessibilityLabel).toContain('Close');
  expect(find(tree, node => node.props.label === 'Add equipment')).toHaveLength(1);
});
