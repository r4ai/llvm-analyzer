define void @caller() {
entry:
  call void @callee()
  ret void
}
