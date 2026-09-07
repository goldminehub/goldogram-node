; Goldogram desktop — inbound TCP 8333 for P2P (idempotent).

!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Goldogram P2P 8333"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Goldogram P2P 8333" dir=in action=allow protocol=TCP localport=8333'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Goldogram P2P 8333"'
!macroend
