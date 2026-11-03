import { useBrandVoices } from "./useBrandVoices";
import { useCharacters } from "./useCharacters";
import { useBlocks } from "./useBlocks";
import { useProducts } from "./useProducts";
import { useICPs } from "./useICPs";
import { useLibraryImages } from "./useLibraryImages";

export function useLibraryStepData(libraryTable: string) {
  const brandVoices = useBrandVoices();
  const characters = useCharacters();
  const blocks = useBlocks();
  const products = useProducts();
  const icps = useICPs();
  const libraryImages = useLibraryImages();

  switch (libraryTable) {
    case 'library_brand_voices':
      return {
        data: brandVoices.brandVoices || [],
        isLoading: brandVoices.isLoading,
        error: brandVoices.error,
        onUpdate: brandVoices.updateBrandVoice,
        onDelete: brandVoices.deleteBrandVoice,
        isUpdating: brandVoices.isUpdating,
        isDeleting: brandVoices.isDeleting,
      };
    case 'library_characters':
      return {
        data: characters.characters || [],
        isLoading: characters.isLoading,
        error: characters.error,
        onUpdate: characters.updateCharacter,
        onDelete: characters.deleteCharacter,
        isUpdating: characters.isUpdating,
        isDeleting: characters.isDeleting,
      };
    case 'library_blocks':
      return {
        data: blocks.blocks || [],
        isLoading: blocks.isLoading,
        error: blocks.error,
        onUpdate: blocks.updateBlock,
        onDelete: blocks.deleteBlock,
        isUpdating: blocks.isUpdating,
        isDeleting: blocks.isDeleting,
      };
    case 'library_products':
      return {
        data: products.products || [],
        isLoading: products.isLoading,
        error: products.error,
        onUpdate: products.updateProduct,
        onDelete: products.deleteProduct,
        isUpdating: products.isUpdating,
        isDeleting: products.isDeleting,
      };
    case 'library_icps':
      return {
        data: icps.icps || [],
        isLoading: icps.isLoading,
        error: icps.error,
        onUpdate: icps.updateICP,
        onDelete: icps.deleteICP,
        isUpdating: icps.isUpdating,
        isDeleting: icps.isDeleting,
      };
    case 'library_images':
      return {
        data: libraryImages.libraryImages || [],
        isLoading: libraryImages.isLoading,
        error: libraryImages.error,
        onUpdate: libraryImages.updateLibraryImage,
        onDelete: libraryImages.deleteLibraryImage,
        isUpdating: libraryImages.isUpdating,
        isDeleting: libraryImages.isDeleting,
      };
    default:
      return {
        data: [],
        isLoading: false,
        error: null,
        onUpdate: async () => { },
        onDelete: async () => { },
        isUpdating: false,
        isDeleting: false
      };
  }
}
