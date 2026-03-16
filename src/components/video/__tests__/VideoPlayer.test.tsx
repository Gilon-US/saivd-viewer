import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { VideoPlayer } from '../VideoPlayer';

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
    const { useWatermarkVerification } = require('@/hooks/useWatermarkVerification');
    useWatermarkVerification.mockImplementation(() => ({ status: 'idle', verifiedUserId: null }));
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

  it('withholds video src when enableFrameAnalysis and verification not yet verified', () => {
    render(
      <VideoPlayer
        {...defaultProps}
        enableFrameAnalysis
        verificationStatus="verifying"
      />
    );
    const video = document.querySelector('video');
    expect(video).not.toHaveAttribute('src');
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

  it('play/pause controls only visible when playback allowed (verified or null status)', () => {
    render(
      <VideoPlayer
        {...defaultProps}
        enableFrameAnalysis
        videoId="test-id"
        verificationStatus="verifying"
      />
    );
    expect(screen.queryByLabelText('Play')).not.toBeInTheDocument();
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
  });

  it('has proper accessibility attributes', () => {
    render(<VideoPlayer {...defaultProps} />);
    expect(screen.getByLabelText('Close video player')).toBeInTheDocument();
  });

  it('calls useWatermarkVerification when verificationEnabled', () => {
    const { useWatermarkVerification } = require('@/hooks/useWatermarkVerification');
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
    const { useWatermarkVerification } = require('@/hooks/useWatermarkVerification');
    let captureOptions: { onVerificationComplete?: (status: "verified" | "failed", userId: string | null) => void } = {};
    useWatermarkVerification.mockImplementation((_ref: unknown, _url: unknown, options: typeof captureOptions) => {
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
