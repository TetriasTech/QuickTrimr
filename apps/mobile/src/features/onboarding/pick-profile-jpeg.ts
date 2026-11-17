import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export async function pickProfileJpeg(maxPixelsPerSide: number) {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
  });
  const asset = picked.assets?.[0];
  if (!asset) return null;
  const image = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > maxPixelsPerSide)
    image.resize(
      asset.width >= asset.height
        ? { width: maxPixelsPerSide }
        : { height: maxPixelsPerSide },
    );
  return (
    await (await image.renderAsync()).saveAsync({ format: SaveFormat.JPEG })
  ).uri;
}
