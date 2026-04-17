package cards

// RedactForRole returns a copy of card with secret fields stripped if
// role is "viewer". Other roles see the card unchanged.
// TOTP codes/secrets are separately gated by endpoint — viewers are
// simply not allowed to call /totps/:id via authz layer.
func RedactForRole(c Card, role string) Card {
	if role != "viewer" {
		return c
	}
	switch c.CardType {
	case "password":
		c.Text = ""
	case "note":
		if c.IsSecret {
			c.Text = ""
		}
	}
	return c
}

// RedactList maps RedactForRole over a slice.
func RedactList(list []Card, role string) []Card {
	if role != "viewer" {
		return list
	}
	out := make([]Card, len(list))
	for i, c := range list {
		out[i] = RedactForRole(c, role)
	}
	return out
}
