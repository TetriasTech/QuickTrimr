import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  consequence: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  visible,
  title,
  consequence,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const presented = useRef(false);

  useEffect(() => {
    if (!visible) {
      presented.current = false;
      return;
    }
    if (presented.current) return;

    presented.current = true;
    Alert.alert(
      title,
      consequence,
      [
        { text: cancelLabel, style: 'cancel', onPress: onCancel },
        {
          text: confirmLabel,
          style: destructive ? 'destructive' : 'default',
          onPress: onConfirm,
        },
      ],
      { cancelable: true, onDismiss: onCancel },
    );
  }, [cancelLabel, confirmLabel, consequence, destructive, onCancel, onConfirm, title, visible]);

  return null;
}
