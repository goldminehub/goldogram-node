; Goldogram desktop — inbound TCP 8333 (P2P) + UDP 8334 (LAN beacon).

!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Goldogram P2P 8333"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Goldogram P2P 8333" dir=in action=allow protocol=TCP localport=8333'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Goldogram LAN 8334"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Goldogram LAN 8334" dir=in action=allow protocol=UDP localport=8334'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Goldogram P2P 8333"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Goldogram LAN 8334"'
!macroend
