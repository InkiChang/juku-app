package top.inkicheng.jukuapp;

import com.getcapacitor.BridgeActivity;

import androidx.activity.OnBackPressedCallback;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NativePlaybackPlugin.class);
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() == null || getBridge().getWebView() == null) {
                    finishAndRemoveTask();
                    return;
                }
                getBridge().getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('juku:system-back'));", null);
            }
        });
    }
}
