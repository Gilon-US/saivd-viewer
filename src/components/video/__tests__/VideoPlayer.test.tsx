import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { VideoPlayer } from '../VideoPlayer';
import { useWatermarkVerification } from '@/hooks/useWatermarkVerification';

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  X: () => <div data-testid="x-icon">X</div>,
  Play: () => <div data-testid="play-icon">Play</div>,
  Pause: () => <div data-testid="pause-icon">Pause</div>,
  Volume2: () => <div data-testid="volume-icon">Volume</div>,
  VolumeX: () => <div data-testid="mute-icon">Mute</div>,
  Maximize: () => <div data-testid="maximize-icon">Maximize</div>,
}));

// Mock useWatermarkVerification hook (verification runs in hook; parent drives status via callback)
jest.mock('@/hooks/useWatermarkVerification', () => ({
  useWatermarkVerification: jest.fn(),
}));

jest.mock('@/hooks/useCreatorQrOverlayPosition', () => ({
  useCreatorQrOverlayPosition: () => ({position: 'top-right', logoUrl: null}),
}));

describe('VideoPlayer', () => {
  const mockOnClose = jest.fn();
  const defaultProps = {
    videoUrl: 'https://example.com/test-video.mp4',
    onClose: mockOnClose,
    isOpen: true,
    enableFrameAnalysis: false,
    verificationStatus: null as "verifying" | "verified" | "failed" | null,
    verifiedUserId: null as string | null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useWatermarkVerification as jest.Mock).mockImplementation(() => ({ status: 'idle', verifiedUserId: null }));
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      writable: true,
      configurable: true,
    });
  });

  it('renders when isOpen is true', () => {
    render(<VideoPlayer {...defaultProps} />);
    const video = document.querySelector('video');
    expect(video).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<VideoPlayer {...defaultProps} isOpen={false} />);

    const video = document.querySelector('video');
    expect(video).not.toBeInTheDocument();
  });

  it('displays the correct video URL when playback is allowed', async () => {
    render(<VideoPlayer {...defaultProps} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const video = document.querySelector('video');
    expect(video).toHaveAttribute('src', defaultProps.videoUrl);
  });

  it('keeps video src attached while verification is in progress', () => {
    render(
      <VideoPlayer
        {...defaultProps}
        enableFrameAnalysis
        verificationStatus="verifying"
      />
    );
    const video = document.querySelector('video');
    expect(video).toHaveAttribute('src', defaultProps.videoUrl);
  });

  it('sets video src when verificationStatus is verified', () => {
    render(
      <VideoPlayer
        {...defaultProps}
        enableFrameAnalysis
        verificationStatus="verified"
        verifiedUserId="123"
      />
    );
    const video = document.querySelector('video');
    expect(video).toHaveAttribute('src', defaultProps.videoUrl);
  });

  it('calls onClose when close button is clicked', () => {
    render(<VideoPlayer {...defaultProps} />);

    const closeButton = screen.getByLabelText('Close video player');
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('play/pause controls remain visible while verification is in progress', () => {
    render(
      <VideoPlayer
        {...defaultProps}
        enableFrameAnalysis
        videoId="test-id"
        verificationStatus="verifying"
      />
    );
    expect(screen.getByLabelText('Play')).toBeInTheDocument();
  });

  it('play/pause controls visible when verificationStatus is verified', () => {
    render(
      <VideoPlayer
        {...defaultProps}
        enableFrameAnalysis
        videoId="test-id"
        verificationStatus="verified"
        verifiedUserId="123"
      />
    );
    expect(screen.getByLabelText('Play')).toBeInTheDocument();
  });

  it('video has crossOrigin anonymous for CORS', () => {
    render(<VideoPlayer {...defaultProps} />);
    const video = document.querySelector('video');
    expect(video).toHaveAttribute('crossOrigin', 'anonymous');
  });

  it('unmounts when closed', () => {
    const { rerender } = render(<VideoPlayer {...defaultProps} />);
    expect(document.querySelector('video')).toBeInTheDocument();
    rerender(<VideoPlayer {...defaultProps} isOpen={false} />);
    expect(document.querySelector('video')).not.toBeInTheDocument();
  });

  it('shows not authentic overlay when verificationStatus is failed', () => {
    render(
      <VideoPlayer
        {...defaultProps}
        enableFrameAnalysis
        videoId="vid-1"
        verificationStatus="failed"
      />
    );
    expect(screen.getByText(/not authentic|viewing not allowed/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Play')).not.toBeInTheDocument();
  });

  it('shows creator profile QR button only after verified identity is available', () => {
    const { rerender } = render(
      <VideoPlayer
        {...defaultProps}
        enableFrameAnalysis
        verificationStatus="verifying"
        verifiedUserId={null}
      />
    );

    expect(screen.queryByLabelText('View creator profile')).not.toBeInTheDocument();

    rerender(
      <VideoPlayer
        {...defaultProps}
        enableFrameAnalysis
        verificationStatus="verified"
        verifiedUserId="123"
        videoId="test-video-id"
      />
    );

    expect(screen.getByLabelText('View creator profile')).toBeInTheDocument();
  });

  it('shows staged verification overlay copy while verifying', () => {
    render(
      <VideoPlayer
        {...defaultProps}
        enableFrameAnalysis
        videoId="vid-2"
        verificationStatus="verifying"
      />
    );
    expect(screen.getByText(/Verifying authenticity|Preparing secure verification/i)).toBeInTheDocument();
  });

  it('has proper accessibility attributes', () => {
    render(<VideoPlayer {...defaultProps} />);
    expect(screen.getByLabelText('Close video player')).toBeInTheDocument();
    expect(screen.getByLabelText('Play')).toBeInTheDocument();
    expect(screen.getByLabelText('Mute')).toBeInTheDocument();
    expect(screen.getByLabelText('Fullscreen')).toBeInTheDocument();
  });

  it('handles fullscreen toggle', () => {
    render(<VideoPlayer {...defaultProps} />);

    const video = document.querySelector('video') as HTMLVideoElement;
    const stage = video.parentElement as HTMLDivElement;
    const fullscreenButton = screen.getByLabelText('Fullscreen');

    stage.requestFullscreen = jest.fn();
    document.exitFullscreen = jest.fn();

    fireEvent.click(fullscreenButton);
    expect(stage.requestFullscreen).toHaveBeenCalled();

    Object.defineProperty(document, 'fullscreenElement', {value: stage, writable: true});
    fireEvent.click(fullscreenButton);
    expect(document.exitFullscreen).toHaveBeenCalled();
  });

  it('does not fullscreen empty stage when ssrVideo without shell root', () => {
    render(
      <VideoPlayer
        {...defaultProps}
        ssrVideo
        playbackContext="public"
        videoId="vid-1"
      />,
    );

    const stage = document.querySelector('[data-video-stage]') as HTMLDivElement;
    stage.requestFullscreen = jest.fn();

    fireEvent.click(screen.getByLabelText('Fullscreen'));

    expect(stage.requestFullscreen).not.toHaveBeenCalled();
  });

  it('fullscreens SSR shell root when ssrVideo is inside PublicVideoShell', () => {
    render(
      <div data-saivd-fullscreen-root data-video-stage className="relative h-full w-full">
        <video data-saivd-public-video="vid-1" />
        <VideoPlayer
          {...defaultProps}
          embedded
          ssrVideo
          playbackContext="public"
          videoId="vid-1"
        />
      </div>,
    );

    const shellRoot = document.querySelector('[data-saivd-fullscreen-root]') as HTMLDivElement;
    const innerStage = shellRoot.querySelector('[data-video-stage]') as HTMLDivElement;
    shellRoot.requestFullscreen = jest.fn();
    innerStage.requestFullscreen = jest.fn();

    fireEvent.click(screen.getByLabelText('Fullscreen'));

    expect(shellRoot.requestFullscreen).toHaveBeenCalled();
    expect(innerStage.requestFullscreen).not.toHaveBeenCalled();
  });

  it('calls useWatermarkVerification when verificationEnabled', () => {
    render(
      <VideoPlayer
        {...defaultProps}
        videoUrl="https://example.com/video.mp4"
        enableFrameAnalysis
        verificationStatus="verifying"
      />
    );
    expect(useWatermarkVerification).toHaveBeenCalledWith(
      expect.anything(),
      'https://example.com/video.mp4',
      expect.objectContaining({ enabled: true })
    );
  });

  it('invokes onVerificationComplete when provided and hook completes', () => {
    const onVerificationComplete = jest.fn();
    let captureOptions: { onVerificationComplete?: (status: "verified" | "failed", userId: string | null) => void } = {};
    (useWatermarkVerification as jest.Mock).mockImplementation((_ref: unknown, _url: unknown, options: typeof captureOptions) => {
      captureOptions = options;
      return { status: 'verifying', verifiedUserId: null };
    });

    render(
      <VideoPlayer
        {...defaultProps}
        enableFrameAnalysis
        verificationStatus="verifying"
        onVerificationComplete={onVerificationComplete}
      />
    );

    expect(captureOptions.onVerificationComplete).toBeDefined();
    act(() => {
      captureOptions.onVerificationComplete?.('verified', '456');
    });
    expect(onVerificationComplete).toHaveBeenCalledWith('verified', '456');
  });
});
