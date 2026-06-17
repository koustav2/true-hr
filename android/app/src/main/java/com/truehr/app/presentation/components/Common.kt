package com.truehr.app.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.truehr.app.presentation.theme.*

fun initials(name: String): String =
  name.trim().split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }.ifBlank { "U" }

@Composable
fun GradientHeader(content: @Composable BoxScope.() -> Unit) {
  Box(
    modifier = Modifier
      .fillMaxWidth()
      .background(Brush.linearGradient(listOf(GreenLight, Green, GreenDark)))
      .statusBarsPadding()
      .padding(horizontal = 20.dp, vertical = 18.dp),
    content = content,
  )
}

@Composable
fun Avatar(name: String, size: Int = 44) {
  Box(
    modifier = Modifier.size(size.dp).clip(CircleShape).background(Surface.copy(alpha = 0.25f)),
    contentAlignment = Alignment.Center,
  ) {
    Text(initials(name), color = Surface, fontWeight = FontWeight.Bold)
  }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
  Text(text, style = MaterialTheme.typography.titleLarge, color = Ink, modifier = modifier.padding(vertical = 6.dp))
}

@Composable
fun InfoCard(content: @Composable ColumnScope.() -> Unit) {
  Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
    Column(Modifier.padding(18.dp), content = content)
  }
}

@Composable
fun InfoRow(label: String, value: String?) {
  Column(Modifier.padding(vertical = 7.dp)) {
    Text(label, color = InkFaint, style = MaterialTheme.typography.labelSmall)
    Text(value?.ifBlank { "—" } ?: "—", color = Ink, style = MaterialTheme.typography.bodyLarge)
  }
}

@Composable
fun PrimaryButton(text: String, enabled: Boolean = true, loading: Boolean = false, onClick: () -> Unit, modifier: Modifier = Modifier) {
  Button(
    onClick = onClick,
    enabled = enabled && !loading,
    shape = RoundedCornerShape(12.dp),
    colors = ButtonDefaults.buttonColors(containerColor = Green, contentColor = Surface),
    modifier = modifier.height(50.dp),
  ) {
    if (loading) CircularProgressIndicator(color = Surface, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
    else Text(text, fontWeight = FontWeight.SemiBold)
  }
}

@Composable
fun AppTextField(value: String, onValueChange: (String) -> Unit, label: String, modifier: Modifier = Modifier, isPassword: Boolean = false, visualTransformation: androidx.compose.ui.text.input.VisualTransformation = androidx.compose.ui.text.input.VisualTransformation.None, trailing: @Composable (() -> Unit)? = null) {
  OutlinedTextField(
    value = value,
    onValueChange = onValueChange,
    label = { Text(label) },
    singleLine = true,
    visualTransformation = visualTransformation,
    trailingIcon = trailing,
    shape = RoundedCornerShape(12.dp),
    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green, focusedLabelColor = Green, cursorColor = Green),
    modifier = modifier.fillMaxWidth(),
  )
}

@Composable
fun CenterLoader() {
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Green) }
}

@Composable
fun ErrorState(message: String, onRetry: (() -> Unit)? = null) {
  Column(Modifier.fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
    Text("⚠️", style = MaterialTheme.typography.headlineSmall)
    Spacer(Modifier.height(8.dp))
    Text(message, color = InkSoft, style = MaterialTheme.typography.bodyLarge)
    if (onRetry != null) { Spacer(Modifier.height(14.dp)); PrimaryButton("Retry", onClick = onRetry) }
  }
}
