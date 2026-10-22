import React from 'react';
import { Animated, PanResponder } from 'react-native';
import { SwipeToDeleteSet } from '../SwipeToDeleteSet';

jest.mock('react-native', () => ({
  ...jest.requireActual('react-native'),
  Animated: {
    Value: class {
      setValue = jest.fn();
      stopAnimation = jest.fn();
    },
    View: 'AnimatedView',
    timing: jest.fn(() => ({ start: jest.fn() })),
  },
  PanResponder: { create: jest.fn(() => ({ panHandlers: {} })) },
}));

describe('set swipe actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(React, 'useRef').mockImplementation((initial: any) => ({ current: initial }));
    jest.spyOn(React, 'useMemo').mockImplementation((factory) => factory());
  });
  afterEach(() => jest.restoreAllMocks());

  const render = (revealed = false) => {
    const setRevealed = jest.fn();
    jest.spyOn(React, 'useState').mockReturnValue([revealed, setRevealed]);
    const onDelete = jest.fn();
    const element = SwipeToDeleteSet({ children: 'set content', onDelete }) as React.ReactElement<any>;
    const handlers = (PanResponder.create as jest.Mock).mock.calls.at(-1)[0];
    return { element, handlers, onDelete, setRevealed };
  };
  const gesture = (dx: number, dy = 0) => ({ dx, dy, numberActiveTouches: 1 });

  test('captures left swipes while allowing vertical scroll, taps, and right swipes on closed rows', () => {
    const { handlers } = render();
    expect(handlers.onMoveShouldSetPanResponder(null, gesture(-30, 3))).toBe(true);
    expect(handlers.onMoveShouldSetPanResponder(null, gesture(-5, 30))).toBe(false);
    expect(handlers.onMoveShouldSetPanResponder(null, gesture(30, 3))).toBe(false);
    expect(handlers.onMoveShouldSetPanResponder(null, gesture(-4))).toBe(false);
  });

  test('swiping reveals the action without deleting; swiping back closes it', () => {
    const { handlers, setRevealed, onDelete } = render();
    handlers.onPanResponderGrant();
    handlers.onPanResponderMove(null, gesture(-60));
    handlers.onPanResponderRelease(null, gesture(-60));
    expect(setRevealed).toHaveBeenLastCalledWith(true);
    expect(Animated.timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: -80 }));
    expect(onDelete).not.toHaveBeenCalled();
    handlers.onPanResponderGrant();
    handlers.onPanResponderRelease(null, gesture(60));
    expect(setRevealed).toHaveBeenLastCalledWith(false);
  });

  test('short or cancelled swipes keep the action closed', () => {
    const { handlers, setRevealed } = render();
    handlers.onPanResponderGrant();
    handlers.onPanResponderRelease(null, gesture(-25));
    expect(setRevealed).toHaveBeenLastCalledWith(false);
    handlers.onPanResponderTerminate();
    expect(setRevealed).toHaveBeenLastCalledWith(false);
  });

  test('only pressing the revealed Delete button invokes deletion', () => {
    const { element, onDelete } = render(true);
    const button = element.props.children[0];
    expect(button.props.testID).toBe('swipe-delete-set-button');
    expect(onDelete).not.toHaveBeenCalled();
    button.props.onPress();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
