package top.inkicheng.jukuapp;

import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import androidx.annotation.Nullable;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Map;

/**
 * Minimal native playback surface for direct MP4/HLS plans.
 *
 * The existing WebView player remains the fallback for backend proxy plans.
 * This plugin deliberately owns only playback and surface placement; Vue
 * continues to own the controls and playback history UI.
 */
@UnstableApi
@CapacitorPlugin(name = "NativePlayback")
public class NativePlaybackPlugin extends Plugin {
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private TextureView textureView;
    private ViewGroup contentRoot;
    private Surface surface;
    private boolean released = true;
    private final Runnable progressTicker = new Runnable() {
        @Override
        public void run() {
            emitState();
            if (!released) mainHandler.postDelayed(this, 500L);
        }
    };

    @Override
    public void load() {
        super.load();
        mainHandler.post(() -> {
            if (getActivity() == null) return;
            View content = getActivity().findViewById(android.R.id.content);
            if (!(content instanceof ViewGroup)) return;
            contentRoot = (ViewGroup) content;
            textureView = new TextureView(getActivity());
            textureView.setVisibility(View.GONE);
            textureView.setOpaque(true);
            textureView.setClickable(false);
            textureView.setFocusable(false);
            textureView.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
                @Override public void onSurfaceTextureAvailable(android.graphics.SurfaceTexture texture, int width, int height) {
                    releaseSurface();
                    surface = new Surface(texture);
                    if (player != null) player.setVideoSurface(surface);
                }
                @Override public void onSurfaceTextureSizeChanged(android.graphics.SurfaceTexture texture, int width, int height) {}
                @Override public boolean onSurfaceTextureDestroyed(android.graphics.SurfaceTexture texture) {
                    releaseSurface();
                    return true;
                }
                @Override public void onSurfaceTextureUpdated(android.graphics.SurfaceTexture texture) {}
            });
            contentRoot.addView(textureView, new ViewGroup.LayoutParams(1, 1));
            textureView.bringToFront();
        });
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.trim().isEmpty()) {
            call.reject("播放地址为空");
            return;
        }
        String mimeType = call.getString("mimeType", "");
        JSObject headersObject = call.getObject("headers", new JSObject());
        long startMs = Math.max(0L, Math.round(call.getDouble("start", 0.0) * 1000.0));
        mainHandler.post(() -> {
            try {
                ensurePlayer(headersObject);
                MediaItem.Builder item = new MediaItem.Builder()
                        .setUri(Uri.parse(url))
                        .setMediaMetadata(new MediaMetadata.Builder().setTitle("短剧播放").build());
                if (mimeType != null && !mimeType.isEmpty()) item.setMimeType(mimeType);
                MediaItem mediaItem = item.build();
                MediaSource source = buildMediaSource(mediaItem, url, headersObject);
                player.setMediaSource(source);
                player.prepare();
                if (startMs > 0) player.seekTo(startMs);
                player.setPlayWhenReady(true);
                released = false;
                ensureVisible();
                mainHandler.removeCallbacks(progressTicker);
                mainHandler.post(progressTicker);
                call.resolve();
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "原生播放器初始化失败" : error.getMessage());
            }
        });
    }

    @PluginMethod
    public void setRect(PluginCall call) {
        int x = Math.max(0, call.getInt("x", 0));
        int y = Math.max(0, call.getInt("y", 0));
        int width = Math.max(1, call.getInt("width", 1));
        int height = Math.max(1, call.getInt("height", 1));
        mainHandler.post(() -> {
            if (textureView == null) return;
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(width, height);
            params.leftMargin = x;
            params.topMargin = y;
            textureView.setLayoutParams(params);
        });
        call.resolve();
    }

    @PluginMethod
    public void setVisible(PluginCall call) {
        boolean visible = call.getBoolean("visible", true);
        mainHandler.post(() -> {
            if (textureView != null) textureView.setVisibility(visible ? View.VISIBLE : View.GONE);
        });
        call.resolve();
    }

    @PluginMethod
    public void play(PluginCall call) {
        mainHandler.post(() -> { if (player != null) player.play(); });
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        mainHandler.post(() -> { if (player != null) player.pause(); });
        call.resolve();
    }

    @PluginMethod
    public void seek(PluginCall call) {
        double seconds = Math.max(0.0, call.getDouble("position", 0.0));
        mainHandler.post(() -> { if (player != null) player.seekTo(Math.round(seconds * 1000.0)); });
        call.resolve();
    }

    @PluginMethod
    public void setRate(PluginCall call) {
        float rate = (float) Math.max(0.25, Math.min(4.0, call.getDouble("rate", 1.0)));
        mainHandler.post(() -> { if (player != null) player.setPlaybackSpeed(rate); });
        call.resolve();
    }

    @PluginMethod
    public void exitApp(PluginCall call) {
        mainHandler.post(() -> {
            if (getActivity() != null) getActivity().finishAndRemoveTask();
        });
        call.resolve();
    }

    @PluginMethod
    public void release(PluginCall call) {
        mainHandler.post(this::releasePlayer);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        releasePlayer();
        super.handleOnDestroy();
    }

    private void ensurePlayer(JSObject headersObject) {
        if (player != null) return;
        Map<String, String> headers = new HashMap<>();
        if (headersObject != null) {
            java.util.Iterator<String> keys = headersObject.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                String value = headersObject.optString(key, "");
                if (value != null && !value.isEmpty()) headers.put(key, value);
            }
        }
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(30000)
                .setDefaultRequestProperties(headers);
        DefaultDataSource.Factory dataSource = new DefaultDataSource.Factory(getActivity(), http);
        player = new ExoPlayer.Builder(getActivity()).setMediaSourceFactory(new ProgressiveMediaSource.Factory(dataSource)).build();
        player.addListener(new Player.Listener() {
            @Override public void onIsPlayingChanged(boolean isPlaying) { emitState(); }
            @Override public void onPlaybackStateChanged(int state) { emitState(); }
            @Override public void onVideoSizeChanged(androidx.media3.common.VideoSize videoSize) { emitState(); }
            @Override public void onPlayerError(PlaybackException error) {
                JSObject event = new JSObject();
                event.put("message", error.getMessage() == null ? "原生播放器错误" : error.getMessage());
                notifyListeners("error", event);
                emitState();
            }
        });
        if (textureView != null && textureView.isAvailable()) {
            releaseSurface();
            surface = new Surface(textureView.getSurfaceTexture());
            player.setVideoSurface(surface);
        }
    }

    private MediaSource buildMediaSource(MediaItem mediaItem, String url, JSObject headersObject) {
        Map<String, String> headers = new HashMap<>();
        if (headersObject != null) {
            java.util.Iterator<String> keys = headersObject.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                headers.put(key, headersObject.optString(key, ""));
            }
        }
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(30000)
                .setDefaultRequestProperties(headers);
        DefaultDataSource.Factory dataSource = new DefaultDataSource.Factory(getActivity(), http);
        String mimeType = mediaItem.localConfiguration == null ? null : mediaItem.localConfiguration.mimeType;
        boolean hls = url.toLowerCase().contains(".m3u8") || "application/vnd.apple.mpegurl".equalsIgnoreCase(mimeType) || "application/x-mpegURL".equalsIgnoreCase(mimeType);
        if (hls) return new HlsMediaSource.Factory(dataSource).createMediaSource(mediaItem);
        return new ProgressiveMediaSource.Factory(dataSource).createMediaSource(mediaItem);
    }

    private void ensureVisible() {
        if (textureView != null) textureView.setVisibility(View.VISIBLE);
    }

    private void emitState() {
        if (player == null) return;
        JSObject event = new JSObject();
        event.put("position", Math.max(0.0, player.getCurrentPosition() / 1000.0));
        event.put("duration", Math.max(0.0, player.getDuration() == C.TIME_UNSET ? 0.0 : player.getDuration() / 1000.0));
        event.put("isPlaying", player.isPlaying());
        event.put("ended", player.getPlaybackState() == Player.STATE_ENDED);
        if (player.getVideoSize() != null) {
            event.put("width", player.getVideoSize().width);
            event.put("height", player.getVideoSize().height);
        }
        notifyListeners("state", event);
        if (player.getPlaybackState() == Player.STATE_ENDED) notifyListeners("ended", new JSObject());
    }

    private void releaseSurface() {
        if (surface != null) {
            surface.release();
            surface = null;
        }
    }

    private void releasePlayer() {
        released = true;
        mainHandler.removeCallbacks(progressTicker);
        if (player != null) {
            player.release();
            player = null;
        }
        releaseSurface();
        if (textureView != null) textureView.setVisibility(View.GONE);
    }
}
