import React, { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../../ui/theme';

const DELETE_WIDTH = 80;

/** A horizontal swipe reveals an explicit action without capturing vertical scrolling. */
export function SwipeToDeleteSet({ children, onDelete }: {
  children: React.ReactNode;
  onDelete: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const open = useRef(false);
  const origin = useRef(0);
  const [revealed, setRevealed] = useState(false);
  const responder = useMemo(() => {
    const settle = (nextOpen: boolean) => {
      open.current = nextOpen;
      setRevealed(nextOpen);
      Animated.timing(translateX, {
        toValue: nextOpen ? -DELETE_WIDTH : 0,
        duration: 150,
        useNativeDriver: true,
      }).start();
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        gesture.numberActiveTouches === 1 && Math.abs(gesture.dx) > 12 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5 &&
        (open.current || gesture.dx < 0),
      onPanResponderGrant: () => {
        translateX.stopAnimation();
        origin.current = open.current ? -DELETE_WIDTH : 0;
      },
      onPanResponderMove: (_, gesture) => {
        translateX.setValue(Math.max(-DELETE_WIDTH, Math.min(0, origin.current + gesture.dx)));
      },
      onPanResponderRelease: (_, gesture) => {
        settle(origin.current + gesture.dx < -DELETE_WIDTH / 2);
      },
      onPanResponderTerminate: () => settle(open.current),
      onPanResponderTerminationRequest: () => true,
    });
  }, [translateX]);

  return (
    <View style={styles.container}>
      {revealed && (
        <TouchableOpacity
          testID="swipe-delete-set-button"
          style={styles.deleteButton}
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel="Delete set"
        >
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
      )}
      <Animated.View style={{ transform: [{ translateX }] }} {...responder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', backgroundColor: '#7F1D1D' },
  deleteButton: {
    position: 'absolute', right: 0, top: 0, bottom: 0,
    width: DELETE_WIDTH, minHeight: 44, alignItems: 'center', justifyContent: 'center',
  },
  deleteText: { color: colors.text, fontSize: 13, fontWeight: '700' },
});
