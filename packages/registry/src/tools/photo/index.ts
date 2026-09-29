import addTextToImage from './add-text-to-image';
import blurImage from './blur-image';
import collageMaker from './collage-maker';
import compressImage from './compress-image';
import cropImage from './crop-image';
import drawOnImage from './draw-on-image';
import exifRemover from './exif-remover';
import imageConverter from './image-converter';
import imageToSvg from './image-to-svg';
import imagesToPdf from './images-to-pdf';
import objectEraser from './object-eraser';
import photoEditor from './photo-editor';
import removeBackground from './remove-background';
import resizeImage from './resize-image';
import rotateImage from './rotate-image';
import socialMediaImageResizer from './social-media-image-resizer';
import splitImage from './split-image';
import upscaleImage from './upscale-image';
import watermarkImage from './watermark-image';

/** Photo tools, in tools/README.md order (P01-P19). */
export default [
  photoEditor,
  cropImage,
  resizeImage,
  rotateImage,
  compressImage,
  imageConverter,
  removeBackground,
  upscaleImage,
  drawOnImage,
  addTextToImage,
  watermarkImage,
  blurImage,
  socialMediaImageResizer,
  splitImage,
  exifRemover,
  collageMaker,
  objectEraser,
  imagesToPdf,
  imageToSvg,
];
