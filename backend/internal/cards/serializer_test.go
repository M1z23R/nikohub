package cards

import (
	"testing"
)

func TestRedactForViewer_SecretNote(t *testing.T) {
	c := Card{CardType: "note", IsSecret: true, Text: "my secret"}
	got := RedactForRole(c, "viewer")
	if got.Text != "" {
		t.Fatalf("expected redacted text, got %q", got.Text)
	}
}

func TestRedactForViewer_Password(t *testing.T) {
	c := Card{CardType: "password", Text: "hunter2"}
	got := RedactForRole(c, "viewer")
	if got.Text != "" {
		t.Fatalf("expected redacted text, got %q", got.Text)
	}
}

func TestRedactForViewer_TotpNameKeptSecretDropped(t *testing.T) {
	c := Card{CardType: "totp", TotpName: "GitHub"}
	got := RedactForRole(c, "viewer")
	if got.TotpName != "GitHub" {
		t.Fatalf("totp_name should survive, got %q", got.TotpName)
	}
}

func TestRedact_EditorUnchanged(t *testing.T) {
	c := Card{CardType: "password", Text: "hunter2"}
	got := RedactForRole(c, "editor")
	if got.Text != "hunter2" {
		t.Fatalf("editor should see real text, got %q", got.Text)
	}
}
