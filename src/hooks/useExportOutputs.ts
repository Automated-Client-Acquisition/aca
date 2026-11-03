import { toast } from "sonner";

interface ExportOutput {
  id: string;
  title: string;
  status: string;
  content: string;
  created_at: string;
  pipeline: string;
  brand_voice?: string;
  angle?: string;
  product?: string;
}

export function useExportOutputs() {
  const exportToJSON = (outputs: any[], filename: string = 'outputs') => {
    try {
      const exportData: ExportOutput[] = outputs.map(output => {
        const data = output.data || {};
        const params = output.generation_params || {};
        const stageData = output.stage_data || {};

        // Build content based on pipeline type
        let content = data.text || data.script || data.content || '';

        // Instagram Carousel: combine caption with slide content
        if (output.pipeline === 'instagram_carousel') {
          const caption = stageData.caption?.content || stageData.caption?.text || data.caption || '';
          const slides = stageData.carousel_content?.slides || data.carousel_content || [];
          const slideText = Array.isArray(slides) ? slides.map((s: any, i: number) => `Slide ${i + 1}: ${typeof s === 'string' ? s : s.text || s.content || ''}`).join('\n') : '';
          content = caption + (slideText ? '\n\n--- Slides ---\n' + slideText : '');
        }

        // Social Media Post: include caption
        if (output.pipeline === 'social_media_post') {
          content = stageData.caption?.content || stageData.caption?.text || data.caption || content;
        }

        // Storyboard Video Longform: include narrative outline from stage_data.outline.content
        if (output.pipeline === 'storyboard_video_longform') {
          content = stageData.outline?.content || stageData.narrative_outline?.text || stageData.narrative_outline || data.narrative_outline || content;
        }

        return {
          id: output.id,
          title: data.title || output.content_ideas?.title || 'Untitled',
          status: output.status,
          content: content,
          created_at: output.created_at,
          pipeline: output.pipeline,
          brand_voice: params.brand_voice?.name || params.brand_voice,
          angle: params.block?.name || params.angle,
          product: params.product?.name || params.product,
        };
      });

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast.success(`Exported ${outputs.length} output${outputs.length !== 1 ? 's' : ''}`);
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export outputs');
    }
  };

  const exportToCSV = (outputs: any[], filename: string = 'outputs') => {
    try {
      const headers = ['ID', 'Title', 'Status', 'Content', 'Pipeline', 'Brand Voice', 'Angle', 'Product', 'Created At'];
      const rows = outputs.map(output => {
        const data = output.data || {};
        const params = output.generation_params || {};
        const stageData = output.stage_data || {};

        // Build content based on pipeline type
        let content = data.text || data.script || data.content || '';

        // Instagram Carousel: combine caption with slide content
        if (output.pipeline === 'instagram_carousel') {
          const caption = stageData.caption?.content || stageData.caption?.text || data.caption || '';
          const slides = stageData.carousel_content?.slides || data.carousel_content || [];
          const slideText = Array.isArray(slides) ? slides.map((s: any, i: number) => `Slide ${i + 1}: ${typeof s === 'string' ? s : s.text || s.content || ''}`).join('\n') : '';
          content = caption + (slideText ? '\n\n--- Slides ---\n' + slideText : '');
        }

        // Social Media Post: include caption
        if (output.pipeline === 'social_media_post') {
          content = stageData.caption?.content || stageData.caption?.text || data.caption || content;
        }

        // Storyboard Video Longform: include narrative outline from stage_data.outline.content
        if (output.pipeline === 'storyboard_video_longform') {
          content = stageData.outline?.content || stageData.narrative_outline?.text || stageData.narrative_outline || data.narrative_outline || content;
        }

        return [
          output.id,
          data.title || output.content_ideas?.title || 'Untitled',
          output.status,
          content.replace(/"/g, '""'),
          output.pipeline,
          params.brand_voice?.name || params.brand_voice || '',
          params.block?.name || params.angle || '',
          params.product?.name || params.product || '',
          output.created_at,
        ];
      });

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast.success(`Exported ${outputs.length} output${outputs.length !== 1 ? 's' : ''}`);
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export outputs');
    }
  };

  const copyToClipboard = async (output: any) => {
    try {
      const data = output.data || {};
      const stageData = output.stage_data || {};
      let content = data.text || data.script || data.content || '';

      // Instagram Carousel: combine caption with slide content
      if (output.pipeline === 'instagram_carousel') {
        const caption = stageData.caption?.content || stageData.caption?.text || data.caption || '';
        const slides = stageData.carousel_content?.slides || data.carousel_content || [];
        const slideText = Array.isArray(slides) ? slides.map((s: any, i: number) => `Slide ${i + 1}: ${typeof s === 'string' ? s : s.text || s.content || ''}`).join('\n') : '';
        content = caption + (slideText ? '\n\n--- Slides ---\n' + slideText : '');
      }

      // Social Media Post: include caption
      if (output.pipeline === 'social_media_post') {
        content = stageData.caption?.content || stageData.caption?.text || data.caption || content;
      }

      // Storyboard Video Longform: include narrative outline from stage_data.outline.content
      if (output.pipeline === 'storyboard_video_longform') {
        content = stageData.outline?.content || stageData.narrative_outline?.text || stageData.narrative_outline || data.narrative_outline || content;
      }

      await navigator.clipboard.writeText(content);
      toast.success('Content copied to clipboard');
    } catch (error) {
      console.error('Copy failed:', error);
      toast.error('Failed to copy content');
    }
  };

  return {
    exportToJSON,
    exportToCSV,
    copyToClipboard,
  };
}
